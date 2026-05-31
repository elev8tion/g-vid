/**
 * XAI Interceptor Pipeline (ESM version for the server)
 */

import { audioAnalyzer } from './interceptors/pre/audio-analyzer.js';
import { promptEnhancer } from './interceptors/pre/prompt-enhancer.js';
import { audioReplacer } from './interceptors/post/audio-replacer.js';

export class PipelineInterceptorError extends Error {
  constructor(stage, interceptor, message) {
    super(message);
    this.stage = stage;
    this.interceptor = interceptor;
  }
}

export class XAIInterceptorPipeline {
  constructor() {
    this.preInterceptors = [];
    this.postInterceptors = [];
  }

  registerPre(interceptor) {
    this.preInterceptors.push(interceptor);
    return this;
  }

  registerPost(interceptor) {
    this.postInterceptors.push(interceptor);
    return this;
  }

  getPreInterceptors() {
    return [...this.preInterceptors];
  }

  getPostInterceptors() {
    return [...this.postInterceptors];
  }

  async runInterceptors(stage, interceptors, value, context, steps) {
    let current = value;

    for (const interceptor of interceptors) {
      const stepName = stage === 'pre'
        ? (interceptor.name === 'audio-analyzer' ? 'audio_analysis' : 'enhance_prompt')
        : 'audio_merge';

      const start = Date.now();
      const stepEntry = {
        name: stepName,
        status: 'running',
        startedAt: start,
      };
      steps.push(stepEntry);

      try {
        console.debug(`[Toolchest] ${stage} interceptor start: ${interceptor.name}`);
        if (stage === 'pre') {
          current = await interceptor.run(current, context);
        } else {
          current = await interceptor.run(current, context);
        }
        stepEntry.status = 'completed';
        stepEntry.durationMs = Date.now() - start;
        console.debug(`[Toolchest] ${stage} interceptor done: ${interceptor.name} in ${stepEntry.durationMs}ms`);
      } catch (err) {
        stepEntry.status = 'failed';
        stepEntry.durationMs = Date.now() - start;
        console.error(`[Toolchest] ${stage} interceptor failed: ${interceptor.name}`, err);
        throw new PipelineInterceptorError(stage, interceptor.name, err?.message || 'Interceptor failed');
      }
    }

    return current;
  }

  async runPre(initialRequest, context) {
    const steps = [];
    const request = await this.runInterceptors('pre', this.preInterceptors, initialRequest, context, steps);
    return { request, steps };
  }

  async runPost(initialVideoUrl, context) {
    const steps = [];
    const videoUrl = await this.runInterceptors('post', this.postInterceptors, initialVideoUrl, context, steps);
    return { videoUrl, steps };
  }

  async execute(initialRequest, context, xaiCall) {
    const steps = [];

    const pre = await this.runPre(initialRequest, context);
    steps.push(...pre.steps);

    const start = Date.now();
    const coreStep = { name: 'xai_video_gen', status: 'running', startedAt: start };
    steps.push(coreStep);
    let videoUrl;
    try {
      console.debug(`[Toolchest] core xAI call start`);
      videoUrl = await xaiCall(pre.request);
      coreStep.status = 'completed';
      coreStep.durationMs = Date.now() - start;
      console.debug(`[Toolchest] core xAI call done in ${coreStep.durationMs}ms`);
    } catch (err) {
      coreStep.status = 'failed';
      coreStep.durationMs = Date.now() - start;
      throw err;
    }

    if (!videoUrl) {
      throw new Error('xAI call returned no video URL');
    }

    const post = await this.runPost(videoUrl, context);
    steps.push(...post.steps, { name: 'done', status: 'completed' });

    return {
      finalVideoUrl: post.videoUrl,
      steps,
    };
  }
}

export function buildPipeline(opts = {}) {
  const pipeline = new XAIInterceptorPipeline();
  const {
    enableAudioAnalysis = true,
    enablePromptEnhancer = true,
    enableAudioReplace = true,
    preInterceptors,
    postInterceptors,
  } = opts;

  const registerPre = (interceptor) => {
    if ((interceptor === audioAnalyzer || interceptor.name === audioAnalyzer.name) && !enableAudioAnalysis) {
      return;
    }
    if ((interceptor === promptEnhancer || interceptor.name === promptEnhancer.name) && !enablePromptEnhancer) {
      return;
    }
    pipeline.registerPre(interceptor);
  };

  const registerPost = (interceptor) => {
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
