import type { PreXAIInterceptor, PostXAIInterceptor, XaiVideoRequest, GenerationContext, PipelineStep } from './types';

export interface PipelineExecutionResult {
  finalVideoUrl: string;
  steps: PipelineStepExecution[];
}

export class XAIInterceptorPipeline {
  private preInterceptors: PreXAIInterceptor[] = [];
  private postInterceptors: PostXAIInterceptor[] = [];

  registerPre(interceptor: PreXAIInterceptor) {
    this.preInterceptors.push(interceptor);
    return this;
  }

  registerPost(interceptor: PostXAIInterceptor) {
    this.postInterceptors.push(interceptor);
    return this;
  }

  /**
   * Executes the full pre → xAI → post pipeline.
   * Designed for maximum observability and long-term maintainability.
   */
  async execute(
    initialRequest: XaiVideoRequest,
    context: GenerationContext,
    xaiCall: (req: XaiVideoRequest) => Promise<string>
  ): Promise<PipelineExecutionResult> {
    const steps: PipelineStepExecution[] = [];

    const runStep = async <T>(
      name: PipelineStep,
      fn: () => Promise<T>,
      details?: string
    ): Promise<T | null> => {
      const start = Date.now();
      const stepEntry: PipelineStepExecution = {
        name,
        status: 'running',
        startedAt: start,
        details,
      };
      steps.push(stepEntry);

      try {
        const result = await fn();
        stepEntry.status = 'completed';
        stepEntry.durationMs = Date.now() - start;
        return result;
      } catch (err) {
        console.error(`[Toolchest] Step "${name}" failed:`, err);
        stepEntry.status = 'failed';
        stepEntry.durationMs = Date.now() - start;
        throw err;
      }
    };

    // === Pre-processing phase ===
    let request = { ...initialRequest };

    for (const interceptor of this.preInterceptors) {
      const stepName: PipelineStep =
        interceptor.name === 'audio-analyzer' ? 'audio_analysis' : 'enhance_prompt';

      await runStep(stepName, async () => {
        console.log(`[Toolchest] Running pre-interceptor: ${interceptor.name}`);
        request = await interceptor.run(request, context);
        return request;
      });
    }

    // === Core xAI call (as its own step) ===
    console.log(`[Toolchest] Sending to xAI with ${request.reference_images?.length || 0} reference images`);
    const videoUrl = await runStep('xai_video_gen', () => xaiCall(request));

    if (!videoUrl) {
      throw new Error('xAI call returned no video URL');
    }

    // === Post-processing phase ===
    let finalVideoUrl = videoUrl;

    for (const interceptor of this.postInterceptors) {
      await runStep('audio_merge', async () => {
        console.log(`[Toolchest] Running post-interceptor: ${interceptor.name}`);
        finalVideoUrl = await interceptor.run(finalVideoUrl, context);
        return finalVideoUrl;
      });
    }

    steps.push({ name: 'done', status: 'completed' });

    return {
      finalVideoUrl,
      steps,
    };
  }
}
