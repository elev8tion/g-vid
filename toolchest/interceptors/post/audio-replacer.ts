import type { PostXAIInterceptor, GenerationContext } from '../../types';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import fetch from 'node-fetch';
import type { PostXAIInterceptor, GenerationContext } from '../../types';

async function getDurationSeconds(filePath: string): Promise<number | null> {
  const candidates = ['/opt/homebrew/bin/ffprobe', 'ffprobe'];
  for (const bin of candidates) {
    try {
      const duration = await new Promise<number>((resolve, reject) => {
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

/**
 * Post-Interceptor: Replaces the audio track of the generated video with the user's original clip.
 * Adds optional audio tempo adjustment to match video duration when drift is noticeable.
 */
export const audioReplacer: PostXAIInterceptor = {
  name: 'audio-replacer',
  async run(videoUrl: string, context: GenerationContext): Promise<string> {
    if (!context.audioPath || !fs.existsSync(context.audioPath)) {
      console.log('[audio-replacer] No user audio provided — returning original video');
      return videoUrl;
    }

    const GENERATED_DIR = path.join(process.cwd(), 'generated');
    if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

    const videoTemp = path.join(GENERATED_DIR, `${context.jobId}-xai.mp4`);
    const finalPath = path.join(GENERATED_DIR, `${context.jobId}-with-user-audio.mp4`);

    // Download xAI video
    const res = await fetch(videoUrl);
    await pipeline(res.body as any, fs.createWriteStream(videoTemp));

    // Optional: time-stretch audio to match video duration if drift is noticeable and ratio is safe
    let audioForMux = context.audioPath;
    try {
      const [vDur, aDur] = await Promise.all([
        getDurationSeconds(videoTemp),
        getDurationSeconds(context.audioPath),
      ]);
      if (vDur && aDur) {
        const drift = Math.abs(vDur - aDur);
        const tempo = vDur / aDur;
        if (drift > 0.1 && tempo > 0.5 && tempo < 2.0) {
          const adjustedAudioPath = path.join(GENERATED_DIR, `${context.jobId}-audio-adjusted${path.extname(context.audioPath) || '.mp3'}`);
          await new Promise<void>((resolve, reject) => {
            const proc = spawn('/opt/homebrew/bin/ffmpeg', [
              '-y',
              '-i', context.audioPath!,
              '-filter:a', `atempo=${tempo}`,
              '-vn',
              adjustedAudioPath,
            ]);
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
            proc.on('error', reject);
          });
          console.log('[audio-replacer] Adjusted audio tempo to match video duration', { videoSeconds: vDur.toFixed(3), audioSeconds: aDur.toFixed(3), tempo: tempo.toFixed(3) });
          audioForMux = adjustedAudioPath;
        } else {
          console.log('[audio-replacer] Durations', { videoSeconds: vDur?.toFixed(3), audioSeconds: aDur?.toFixed(3), tempo: tempo?.toFixed(3), note: 'no adjustment' });
        }
      }
    } catch (err) {
      console.warn('[audio-replacer] Duration check/adjust failed, continuing without tempo adjust:', (err as Error)?.message || err);
    }

    // Run ffmpeg replacement
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('/opt/homebrew/bin/ffmpeg', [
        '-y',
        '-i', videoTemp,
        '-i', audioForMux,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        finalPath,
      ]);

      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
      proc.on('error', reject);
    });

    // Cleanup temp
    fs.unlinkSync(videoTemp);
    if (audioForMux !== context.audioPath) {
      try { fs.unlinkSync(audioForMux); } catch {}
    }

    const publicUrl = `http://localhost:8787/generated/${path.basename(finalPath)}`;
    console.log('[audio-replacer] Successfully replaced audio. New URL:', publicUrl);
    return publicUrl;
  },
};
