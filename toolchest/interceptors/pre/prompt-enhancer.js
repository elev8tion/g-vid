/**
 * ESM version of prompt-enhancer
 */

export const promptEnhancer = {
  name: 'prompt-enhancer',
  async run(request, context) {
    let enhancedPrompt = request.prompt;

    if (context.referenceImages && context.referenceImages.length > 0) {
      enhancedPrompt += `\n\nCRITICAL VISUAL REFERENCE INSTRUCTIONS:\nUse the provided reference images as the exact visual source for the main performer. Maintain 100% consistent facial features, skin tone, hair, and likeness from the references throughout the entire clip. Do not alter the performer's appearance.`;
    }

    if (context.audioPath) {
      enhancedPrompt += `\n\nAUDIO GROUND TRUTH: The exact 8-second vocal performance from the user's uploaded audio is the only source of singing and timing. Match mouth movements, breaths, and phrasing with perfect accuracy to that specific audio clip.`;
    }

    return { ...request, prompt: enhancedPrompt };
  },
};
