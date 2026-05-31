/**
 * Optional Wav2Lip post-processor (ESM). Guarded by env and presence of CLI + checkpoint.
 * If not configured, it will log and return the original video URL.
 *
 * Required env when enabling:
 *   WAV2LIP_ENABLED=1
 *   WAV2LIP_CLI=python3 (or full path to python)
 *   WAV2LIP_SCRIPT=/path/to/wav2lip.py
 *   WAV2LIP_CHECKPOINT=/path/to/wav2lip_gan.pth
 * Optional:
 *   WAV2LIP_DEVICE=mps|cpu|cuda (passed as --device)
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline as streamPipeline } from 'node:stream/promises';

export const audioLipSyncWav2Lip = {
  name: 'audio-lip-sync-wav2lip',
  async run(videoUrl, context) {
    const enabled = process.env.WAV2LIP_ENABLED === '1';
    if (!enabled) return videoUrl;

    const cli = process.env.WAV2LIP_CLI || 'python3';
    const script = process.env.WAV2LIP_SCRIPT;
    const checkpoint = process.env.WAV2LIP_CHECKPOINT;
    const device = process.env.WAV2LIP_DEVICE; // optional

    if (!script || !checkpoint) {
      console.warn('[wav2lip] Missing WAV2LIP_SCRIPT or WAV2LIP_CHECKPOINT. Skipping.');
      return videoUrl;
    }

    if (!context.audioPath || !fs.existsSync(context.audioPath)) {
      console.warn('[wav2lip] No audioPath available. Skipping.');
      return videoUrl;
    }

    const GENERATED_DIR = path.join(process.cwd(), 'generated');
    if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

    const isRemote = /^https?:\/\//i.test(videoUrl);
    const downloadedPath = isRemote
      ? path.join(GENERATED_DIR, `${context.jobId || 'job'}-wav2lip-input.mp4`)
      : videoUrl;

    if (isRemote) {
      try {
        const res = await (globalThis.fetch || (await import('node-fetch')).default)(videoUrl);
        if (!res.ok || !res.body) {
          console.warn('[wav2lip] Failed to download video. Skipping.', res.status, res.statusText);
          return videoUrl;
        }
        await streamPipeline(res.body, fs.createWriteStream(downloadedPath));
      } catch (err) {
        console.warn('[wav2lip] Error downloading video. Skipping.', err);
        return videoUrl;
      }
    } else if (!fs.existsSync(downloadedPath)) {
      console.warn('[wav2lip] Video file not found at', downloadedPath);
      return videoUrl;
    }

    const outputPath = path.join(GENERATED_DIR, `${context.jobId || 'job'}-wav2lip.mp4`);

    const args = [
      script,
      '--checkpoint_path', checkpoint,
      '--face', downloadedPath,
      '--audio', context.audioPath,
      '--outfile', outputPath,
    ];
    if (device) args.push('--device', device);

    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(cli, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (d) => (stderr += d.toString()));
        proc.on('close', (code) => {
          if (code === 0) return resolve();
          reject(new Error(`wav2lip exited ${code}: ${stderr.slice(0, 400)}`));
        });
        proc.on('error', reject);
      });
    } catch (err) {
      console.warn('[wav2lip] Execution failed, returning original video:', err?.message || err);
      if (isRemote) { try { fs.unlinkSync(downloadedPath); } catch {} }
      return videoUrl;
    }

    if (isRemote) {
      try { fs.unlinkSync(downloadedPath); } catch {}
    }

    const publicUrl = `http://localhost:8787/generated/${path.basename(outputPath)}`;
    console.log('[wav2lip] Completed. New URL:', publicUrl);
    return publicUrl;
  },
};
