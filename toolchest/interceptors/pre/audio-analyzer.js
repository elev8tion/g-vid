/**
 * ESM version of audio-analyzer (simplified runtime)
 */
import fs from 'node:fs';

export const audioAnalyzer = {
  name: 'audio-analyzer',
  async run(request, context) {
    if (!context.audioPath || !fs.existsSync(context.audioPath)) {
      return request;
    }

    // Lightweight version for now
    const stats = fs.statSync(context.audioPath);
    const sizeKB = Math.round(stats.size / 1024);

    let character = sizeKB > 180 ? 'high energy' : sizeKB > 120 ? 'medium energy' : 'intimate';

    const enhancement = `

AUDIO PERFORMANCE ANALYSIS:
- Window: 8s from ${context.trimWindow?.start?.toFixed?.(1) || '0.0'}s
- Character: ${character} vocal performance
- Instruction: Match the rhythmic feel and emotional intensity of this exact recording.`;

    return { ...request, prompt: request.prompt + enhancement };
  },
};
