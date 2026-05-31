/**
 * ESM version of audio-replacer
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

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

    const finalPath = path.join(GENERATED_DIR, `${context.jobId}-with-user-audio.mp4`);

    await new Promise((resolve, reject) => {
      const proc = spawn('/opt/homebrew/bin/ffmpeg', [
        '-y',
        '-i', downloadedPath,
        '-i', userAudio,
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

    const publicUrl = `http://localhost:8787/generated/${path.basename(finalPath)}`;
    console.log('[audio-replacer] Successfully replaced audio. New URL:', publicUrl);
    return publicUrl;
  },
};
