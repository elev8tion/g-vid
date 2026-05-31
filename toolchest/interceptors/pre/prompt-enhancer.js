/**
 * ESM version of prompt-enhancer (lip-sync first ordering)
 */

export const promptEnhancer = {
  name: 'prompt-enhancer',
  async run(request, context) {
    const timingLine = context.trimWindow
      ? `LIP SYNC FIRST: Match visemes and jaw to the exact 8s audio window (${context.trimWindow.start.toFixed(1)}–${(context.trimWindow.start + context.trimWindow.duration).toFixed(1)}s). If silence, keep mouth closed/still.`
      : 'LIP SYNC FIRST: Match visemes and jaw to the exact provided 8s audio. If silence, keep mouth closed/still.';

    let enhancedPrompt = `${timingLine}\n`;

    if (context.referenceImages && context.referenceImages.length > 0) {
      enhancedPrompt += `CRITICAL VISUAL SOURCE: Use the reference images as the ONLY identity source for the performer. No changes to face, hair, skin tone. Preserve likeness across all frames.\n`;
    }

    enhancedPrompt += `PERFORMANCE: The uploaded audio is ground truth. Do NOT generate or improvise singing. Perfect lip sync to timing, phonemes, breaths. Stable, realistic jaw/cheek/tongue motion.\n`;

    if (context.audioPath) {
      enhancedPrompt += `SYNC: This clip must visually track the provided audio. If you cannot align, prioritize accurate mouth shapes over extra motion.\n`;
    }

    // Append the original prompt last to keep high-priority lip-sync instructions up front
    enhancedPrompt += `ORIGINAL PROMPT: ${request.prompt}`;

    return { ...request, prompt: enhancedPrompt };
  },
};
