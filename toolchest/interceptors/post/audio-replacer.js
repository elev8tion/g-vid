/**
 * ESM version of audio-replacer
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

async function getDurationSeconds(filePath) {
  const candidates = ['/opt/homebrew/bin/ffprobe', 'ffprobe'];
  for (const bin of candidates) {
    try {
      const duration = await new Promise((resolve, reject) => {
        const proc = spawn(bin, [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          filePath,
        ]);
        let out = '';
        proc.stdout.on('data', (d) => (out += d.toString()));
        proc.on('close', (code) => {
          if (code === 0) {
            const val = parseFloat(out.trim());
            if (!Number.isNaN(val)) return resolve(val);
          }
          reject(new Error(`ffprobe exited ${code}`));
        });
        proc.on('error', reject);
      });
      return duration;
    } catch (err) {
      // try next candidate
    }
  }
  return null;
}

export const audioReplacer = {
  name: 'audio-replacer',
  async run(videoPath, context) {
    // Support both audioPath (from generationContext) and originalAudioPath (from job store)
    const userAudio = context.audioPath || context.originalAudioPath;

    if (!userAudio || !fs.existsSync(userAudio)) {
      console.log('[audio-replacer] No user audio provided — returning original video');
      return videoPath;
    }

    const GENERATED_DIR = path.join(process.cwd(), 'generated');
    if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

    const fetchFn = globalThis.fetch || (await import('node-fetch')).default;

    const isRemote = typeof videoPath === 'string' && (videoPath.startsWith('http://') || videoPath.startsWith('https://'));
    const downloadedPath = isRemote ? path.join(GENERATED_DIR, `${context.jobId}-xai.mp4`) : videoPath;

    if (isRemote) {
      try {
        const res = await fetchFn(videoPath);
        if (!res.ok || !res.body) {
          console.error('[audio-replacer] Failed to download video from', videoPath, res.status, res.statusText);
          return videoPath;
        }
        await pipeline(res.body, fs.createWriteStream(downloadedPath));
      } catch (err) {
        console.error('[audio-replacer] Error downloading video', err);
        return videoPath;
      }
    } else if (!fs.existsSync(downloadedPath)) {
      console.error('[audio-replacer] Video file not found at', downloadedPath);
      return videoPath;
    }

    // Optional: time-stretch audio to match video duration if drift is noticeable and ratio is safe
    let audioForMux = userAudio;
    try {
      const [vDur, aDur] = await Promise.all([
        getDurationSeconds(downloadedPath),
        getDurationSeconds(userAudio),
      ]);
        if (vDur && aDur) {
        const drift = Math.abs(vDur - aDur);
        const tempo = vDur / aDur;
        const DRIFT_THRESHOLD = 0.02; // 20ms
        const TEMPO_MIN = 0.5;
        const TEMPO_MAX = 2.0;
        if (drift > DRIFT_THRESHOLD && tempo > TEMPO_MIN && tempo < TEMPO_MAX) {
          const adjustedAudioPath = path.join(GENERATED_DIR, `${context.jobId}-audio-adjusted${path.extname(userAudio) || '.mp3'}`);
          await new Promise((resolve, reject) => {
            const proc = spawn('/opt/homebrew/bin/ffmpeg', [
              '-y',
              '-i', userAudio,
              '-filter:a', `atempo=${tempo}`,
              '-vn',
              adjustedAudioPath,
            ]);
            proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
            proc.on('error', reject);
          });
          console.log('[audio-replacer] Adjusted audio tempo to match video duration', { videoSeconds: vDur.toFixed(3), audioSeconds: aDur.toFixed(3), tempo: tempo.toFixed(3) });
          audioForMux = adjustedAudioPath;
        } else {
          console.log('[audio-replacer] Durations', { videoSeconds: vDur?.toFixed(3), audioSeconds: aDur?.toFixed(3), tempo: tempo?.toFixed(3), note: 'no adjustment' });
        }
      }
    } catch (err) {
      console.warn('[audio-replacer] Duration check/adjust failed, continuing without tempo adjust:', err?.message || err);
    }

    const finalPath = path.join(GENERATED_DIR, `${context.jobId}-with-user-audio.mp4`);

    await new Promise((resolve, reject) => {
      const proc = spawn('/opt/homebrew/bin/ffmpeg', [
        '-y',
        '-i', downloadedPath,
        '-i', audioForMux,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        finalPath,
      ]);

      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
      proc.on('error', reject);
    });

    if (isRemote) {
      try { fs.unlinkSync(downloadedPath); } catch {}
    }
    if (audioForMux !== userAudio) {
      try { fs.unlinkSync(audioForMux); } catch {}
    }

    const publicUrl = `http://localhost:8787/generated/${path.basename(finalPath)}`;
    console.log('[audio-replacer] Successfully replaced audio. New URL:', publicUrl);
    return publicUrl;
  },
};
