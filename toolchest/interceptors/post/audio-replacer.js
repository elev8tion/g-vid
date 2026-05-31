/**
 * ESM version of audio-replacer
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export const audioReplacer = {
  name: 'audio-replacer',
  async run(videoPath, context) {
    // Support both audioPath (from generationContext) and originalAudioPath (from job store)
    const userAudio = context.audioPath || context.originalAudioPath;

    if (!userAudio || !fs.existsSync(userAudio)) {
      console.log('[audio-replacer] No user audio provided — returning original video');
      return videoPath;
    }

    if (!fs.existsSync(videoPath)) {
      console.error('[audio-replacer] Video file not found at', videoPath);
      return videoPath;
    }

    const GENERATED_DIR = path.join(process.cwd(), 'generated');
    if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

    const finalPath = path.join(GENERATED_DIR, `${context.jobId}-with-user-audio.mp4`);

    await new Promise((resolve, reject) => {
      const proc = spawn('/opt/homebrew/bin/ffmpeg', [
        '-y',
        '-i', videoPath,
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

    const publicUrl = `http://localhost:8787/generated/${path.basename(finalPath)}`;
    console.log('[audio-replacer] Successfully replaced audio. New URL:', publicUrl);
    return finalPath; // return local path so caller detects the muxed file and builds the final public URL
  },
};
