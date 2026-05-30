/**
 * XAI Interceptor Pipeline (ESM version for the server)
 */

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

  async execute(initialRequest, context, xaiCall) {
    let request = { ...initialRequest };

    for (const interceptor of this.preInterceptors) {
      console.log(`[Toolchest] Running pre-interceptor: ${interceptor.name}`);
      request = await interceptor.run(request, context);
    }

    console.log(`[Toolchest] Sending to xAI with ${request.reference_images?.length || 0} reference images`);
    let videoUrl = await xaiCall(request);

    for (const interceptor of this.postInterceptors) {
      console.log(`[Toolchest] Running post-interceptor: ${interceptor.name}`);
      videoUrl = await interceptor.run(videoUrl, context);
    }

    return videoUrl;
  }
}
