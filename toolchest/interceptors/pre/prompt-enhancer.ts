import type { PreXAIInterceptor, XaiVideoRequest, GenerationContext } from '../../types';

/**
 * Example Pre-Interceptor: Enhances the prompt with explicit reference instructions.
 * Inspired by VisualEssential's structured prompting patterns (outfit system, scene motionPrompts).
 */
export const promptEnhancer: PreXAIInterceptor = {
  name: 'prompt-enhancer',
  async run(request: XaiVideoRequest, context: GenerationContext): Promise<XaiVideoRequest> {
    let enhancedPrompt = request.prompt;

    if (context.referenceImages.length > 0) {
      enhancedPrompt += `\n\nCRITICAL VISUAL REFERENCE INSTRUCTIONS:\n`;
      enhancedPrompt += `Use the provided reference images as the exact visual source for the main performer. `;
      enhancedPrompt += `Maintain 100% consistent facial features, skin tone, hair, and likeness from the references throughout the entire clip. `;
      enhancedPrompt += `Do not alter the performer's appearance.`;
    }

    if (context.audioPath) {
      enhancedPrompt += `\n\nAUDIO GROUND TRUTH: The exact 8-second vocal performance from the user's uploaded audio is the only source of singing and timing. `;
      enhancedPrompt += `Match mouth movements, breaths, and phrasing with perfect accuracy to that specific audio clip.`;
    }

    return {
      ...request,
      prompt: enhancedPrompt,
    };
  },
};
