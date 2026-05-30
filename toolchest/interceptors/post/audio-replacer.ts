import type { PostXAIInterceptor, GenerationContext } from '../../types';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import fetch from 'node-fetch';

/**
 * Post-Interceptor: Replaces the audio track of the generated video with the user's original clip.
 * This is the production version of our current ffmpeg audio replacement logic.
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

    // Run ffmpeg replacement
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('/opt/homebrew/bin/ffmpeg', [
        '-y',
        '-i', videoTemp,
        '-i', context.audioPath!,
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

    const publicUrl = `http://localhost:8787/generated/${path.basename(finalPath)}`;
    console.log('[audio-replacer] Successfully replaced audio. New URL:', publicUrl);
    return publicUrl;
  },
};
