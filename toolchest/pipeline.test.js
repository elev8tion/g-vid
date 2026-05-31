import test from 'node:test';
import assert from 'node:assert/strict';
import { XAIInterceptorPipeline, buildPipeline } from './pipeline.js';

const mockContext = {
  jobId: 'job_test',
  originalPrompt: 'base',
  referenceImages: [],
  shot: { id: 's', name: 's', description: '', promptHint: '' },
  trimWindow: { start: 0, duration: 8 },
};

test('execute runs pre → core → post in order', async () => {
  const events = [];
  const pipeline = new XAIInterceptorPipeline()
    .registerPre({
      name: 'pre-1',
      async run(req) {
        events.push('pre-1');
        return { ...req, prompt: `${req.prompt} pre1` };
      },
    })
    .registerPre({
      name: 'pre-2',
      async run(req) {
        events.push('pre-2');
        return { ...req, prompt: `${req.prompt} pre2` };
      },
    })
    .registerPost({
      name: 'post-1',
      async run(videoUrl) {
        events.push('post-1');
        return `${videoUrl}-post`;
      },
    });

  const result = await pipeline.execute(
    { model: 'm', prompt: 'p', duration: 8, aspect_ratio: '16:9', resolution: '720p' },
    mockContext,
    async (req) => {
      events.push('core');
      assert.ok(req.prompt.includes('pre1'));
      assert.ok(req.prompt.includes('pre2'));
      return 'video://url';
    }
  );

  assert.deepEqual(events, ['pre-1', 'pre-2', 'core', 'post-1']);
  assert.equal(result.finalVideoUrl, 'video://url-post');
});

test('buildPipeline respects toggles', async () => {
  const pipeline = buildPipeline({
    enableAudioAnalysis: false,
    enablePromptEnhancer: true,
    enableAudioReplace: false,
  });

  const preNames = pipeline.getPreInterceptors().map((i) => i.name);
  const postNames = pipeline.getPostInterceptors().map((i) => i.name);

  assert.deepEqual(preNames, ['prompt-enhancer']);
  assert.deepEqual(postNames, []);
});
