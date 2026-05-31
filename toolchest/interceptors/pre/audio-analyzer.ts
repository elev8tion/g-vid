import type { PreXAIInterceptor, XaiVideoRequest, GenerationContext, PipelineStepExecution } from '../../types';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Audio Analyzer Pre-Interceptor (High Quality Version)
 * 
 * Analyzes the user's exact 8-second smart-trimmed audio clip and injects
 * concrete, data-driven instructions into the xAI prompt.
 * 
 * This is currently one of the highest-leverage things we can do because
 * the xAI video API does not accept raw audio as input.
 * 
 * Ideas drawn from production audio_merge / timing-sensitive pipelines
 * (inspiration only — fully rewritten for our xAI + prompt-only reality).
 */
export const audioAnalyzer: PreXAIInterceptor = {
  name: 'audio-analyzer',

  async run(request: XaiVideoRequest, context: GenerationContext): Promise<XaiVideoRequest> {
    if (!context.audioPath || !fs.existsSync(context.audioPath)) {
      return request;
    }

    try {
      const analysis = await this.analyzeWithFfmpeg(context.audioPath);

      let character = '';
      if (analysis.meanVolume > -10) {
        character = 'very high energy, powerful, dense, and projected vocal performance';
      } else if (analysis.meanVolume > -16) {
        character = 'strong, clear, and present vocal performance with good dynamics';
      } else if (analysis.meanVolume > -22) {
        character = 'medium energy, clear and intimate vocal performance';
      } else {
        character = 'intimate, nuanced, and sensitive vocal performance with wide dynamics';
      }

      const beatNote = analysis.beats.length > 0
        ? `Strong rhythmic / percussive accents detected around these approximate times (in seconds from clip start): ${analysis.beats.map(b => b.toFixed(1)).join(', ')}. Hit these moments with conviction, body movement, and precise lip sync.`
        : 'Maintain consistent rhythmic feel and natural phrasing throughout the clip.';

      const timingCues = analysis.beats.length > 0
        ? `TIMING CUES (seconds from clip start): ${analysis.beats.slice(0, 8).map(b => b.toFixed(1)).join(', ')}. Lip-sync mouth shapes to these onsets; keep jaw/visemes tightly aligned.`
        : `TIMING CUES: Keep steady phrasing across the full 8s window; no silent gaps to fill.`;

      const enhancement = `

AUDIO PERFORMANCE ANALYSIS (use this as absolute ground truth for the performance):
- Exact window: 8 seconds starting at ${context.trimWindow.start.toFixed(1)}s of the original recording.
- Overall character: ${character}
- ${beatNote}
- ${timingCues}
- Critical: The mouth shapes, jaw, tongue, and micro-expressions must match the phonemes and exact timing of this specific recording. Do not generate generic or improved singing — replicate the raw, human performance in the file with perfect accuracy.`;

      return {
        ...request,
        prompt: request.prompt + enhancement,
      };
    } catch (err) {
      console.warn('[audio-analyzer] Analysis failed, falling back to basic description', err);
      return this.fallbackAnalysis(request, context);
    }
  },

  async analyzeWithFfmpeg(audioPath: string) {
    return new Promise<any>((resolve, reject) => {
      const args = [
        '-i', audioPath,
        '-af', 'volumedetect,astats=measure_overall=1:measure_perchannel=0,silencedetect=noise=0.02:d=0.15',
        '-f', 'null', '-'
      ];

      const proc = spawn('/opt/homebrew/bin/ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d.toString()));

      proc.on('close', (code) => {
        if (code !== 0 && code !== 1) {
          return reject(new Error(`ffmpeg exited with code ${code}`));
        }

        const volMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
        const meanVolume = volMatch ? parseFloat(volMatch[1]) : -18;

        const beats: number[] = [];
        const silenceStarts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)];
        silenceStarts.forEach((m, i) => {
          if (i % 2 === 0) beats.push(parseFloat(m[1]));
        });

        resolve({
          meanVolume,
          beats: beats.slice(0, 8),
        });
      });

      proc.on('error', reject);
    });
  },

  fallbackAnalysis(request: XaiVideoRequest, context: GenerationContext) {
    const stats = fs.statSync(context.audioPath!);
    const sizeKB = Math.round(stats.size / 1024);

    let character = sizeKB > 180 ? 'high energy' : sizeKB > 120 ? 'medium energy' : 'intimate';
    const enhancement = `

AUDIO PERFORMANCE ANALYSIS (basic fallback):
- Window: 8 seconds from ${context.trimWindow.start.toFixed(1)}s
- Character: ${character} vocal performance
- Instruction: Match the rhythmic feel and emotional intensity of this exact recording.`;

    return { ...request, prompt: request.prompt + enhancement };
  },
};
