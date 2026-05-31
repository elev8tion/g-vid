import type { PreXAIInterceptor, PostXAIInterceptor, XaiVideoRequest, GenerationContext, PipelineStep, PipelineStepExecution } from './types';
import { audioAnalyzer } from './interceptors/pre/audio-analyzer';
import { promptEnhancer } from './interceptors/pre/prompt-enhancer';
import { audioReplacer } from './interceptors/post/audio-replacer';

export interface PipelineExecutionResult {
  finalVideoUrl: string;
  steps: PipelineStepExecution[];
}

export class PipelineInterceptorError extends Error {
  stage: 'pre' | 'post';
  interceptor: string;

  constructor(stage: 'pre' | 'post', interceptor: string, message: string) {
    super(message);
    this.stage = stage;
    this.interceptor = interceptor;
  }
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

  getPreInterceptors() {
    return [...this.preInterceptors];
  }

  getPostInterceptors() {
    return [...this.postInterceptors];
  }

  private async runInterceptors<T>(
    stage: 'pre' | 'post',
    interceptors: Array<PreXAIInterceptor | PostXAIInterceptor>,
    value: T,
    context: GenerationContext,
    steps: PipelineStepExecution[],
  ): Promise<T> {
    let current: any = value;

    for (const interceptor of interceptors) {
      const stepName: PipelineStep = stage === 'pre'
        ? (interceptor.name === 'audio-analyzer' ? 'audio_analysis' : 'enhance_prompt')
        : 'audio_merge';

      const start = Date.now();
      const stepEntry: PipelineStepExecution = {
        name: stepName,
        status: 'running',
        startedAt: start,
      };
      steps.push(stepEntry);

      try {
        console.debug(`[Toolchest] ${stage} interceptor start: ${interceptor.name}`);
        if (stage === 'pre') {
          current = await (interceptor as PreXAIInterceptor).run(current, context);
        } else {
          current = await (interceptor as PostXAIInterceptor).run(current as any, context);
        }
        stepEntry.status = 'completed';
        stepEntry.durationMs = Date.now() - start;
        console.debug(`[Toolchest] ${stage} interceptor done: ${interceptor.name} in ${stepEntry.durationMs}ms`);
      } catch (err: any) {
        stepEntry.status = 'failed';
        stepEntry.durationMs = Date.now() - start;
        console.error(`[Toolchest] ${stage} interceptor failed: ${interceptor.name}`, err);
        throw new PipelineInterceptorError(stage, interceptor.name, err?.message || 'Interceptor failed');
      }
    }

    return current as T;
  }

  async runPre(
    initialRequest: XaiVideoRequest,
    context: GenerationContext,
  ): Promise<{ request: XaiVideoRequest; steps: PipelineStepExecution[] }> {
    const steps: PipelineStepExecution[] = [];
    const request = await this.runInterceptors('pre', this.preInterceptors, initialRequest, context, steps);
    return { request, steps };
  }

  async runPost(
    initialVideoUrl: string,
    context: GenerationContext,
  ): Promise<{ videoUrl: string; steps: PipelineStepExecution[] }> {
    const steps: PipelineStepExecution[] = [];
    const videoUrl = await this.runInterceptors('post', this.postInterceptors, initialVideoUrl, context, steps);
    return { videoUrl, steps };
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

    // === Pre-processing phase ===
    const { request, steps: preSteps } = await this.runPre(initialRequest, context);
    steps.push(...preSteps);

    // === Core xAI call (as its own step) ===
    const start = Date.now();
    const coreStep: PipelineStepExecution = { name: 'xai_video_gen', status: 'running', startedAt: start };
    steps.push(coreStep);
    let videoUrl: string;
    try {
      console.debug(`[Toolchest] core xAI call start`);
      videoUrl = await xaiCall(request);
      coreStep.status = 'completed';
      coreStep.durationMs = Date.now() - start;
      console.debug(`[Toolchest] core xAI call done in ${coreStep.durationMs}ms`);
    } catch (err: any) {
      coreStep.status = 'failed';
      coreStep.durationMs = Date.now() - start;
      throw err;
    }

    if (!videoUrl) {
      throw new Error('xAI call returned no video URL');
    }

    // === Post-processing phase ===
    const { videoUrl: finalVideoUrl, steps: postSteps } = await this.runPost(videoUrl, context);
    steps.push(...postSteps, { name: 'done', status: 'completed' });

    return {
      finalVideoUrl,
      steps,
    };
  }
}

export interface BuildPipelineOptions {
  enableAudioAnalysis?: boolean;
  enablePromptEnhancer?: boolean;
  enableAudioReplace?: boolean;
  preInterceptors?: PreXAIInterceptor[];
  postInterceptors?: PostXAIInterceptor[];
}

export function buildPipeline(opts: BuildPipelineOptions = {}): XAIInterceptorPipeline {
  const pipeline = new XAIInterceptorPipeline();
  const {
    enableAudioAnalysis = true,
    enablePromptEnhancer = true,
    enableAudioReplace = true,
    preInterceptors,
    postInterceptors,
  } = opts;

  const registerPre = (interceptor: PreXAIInterceptor) => {
    if ((interceptor === audioAnalyzer || interceptor.name === audioAnalyzer.name) && !enableAudioAnalysis) {
      return;
    }
    if ((interceptor === promptEnhancer || interceptor.name === promptEnhancer.name) && !enablePromptEnhancer) {
      return;
    }
    pipeline.registerPre(interceptor);
  };

  const registerPost = (interceptor: PostXAIInterceptor) => {
    if ((interceptor === audioReplacer || interceptor.name === audioReplacer.name) && !enableAudioReplace) {
      return;
    }
    pipeline.registerPost(interceptor);
  };

  if (preInterceptors?.length) {
    preInterceptors.forEach(registerPre);
  } else {
    registerPre(audioAnalyzer);
    registerPre(promptEnhancer);
  }

  if (postInterceptors?.length) {
    postInterceptors.forEach(registerPost);
  } else {
    registerPost(audioReplacer);
  }

  return pipeline;
}

export const defaultPipeline = buildPipeline({
  preInterceptors: [promptEnhancer, audioAnalyzer],
  postInterceptors: [audioReplacer],
});
