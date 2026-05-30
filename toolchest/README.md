# g-vid Toolchest

Custom, fully-owned interceptors and tools that sit around the xAI video generation call.

## Philosophy
- Zero dependency on closed video services (Kling, Runway, Luma, etc.).
- Everything is code we control and can improve.
- Inspired by real production patterns extracted from VisualEssential (17-ai-generation-pipeline, 18-outfit-system, etc.) but adapted for our xAI + custom tool approach.

## Current Interceptors

### Pre-xAI
- `prompt-enhancer` — Strengthens the prompt with explicit reference image and audio instructions.

### Post-xAI
- `audio-replacer` — Replaces the generated audio track with the user's exact 8s clip using ffmpeg.

## How to Use (in server/index.js)

```ts
import { XAIInterceptorPipeline, promptEnhancer, audioReplacer } from '../toolchest';

const pipeline = new XAIInterceptorPipeline()
  .registerPre(promptEnhancer)
  .registerPost(audioReplacer);

// Later, when calling xAI:
const finalVideoUrl = await pipeline.execute(xaiPayload, context, async (req) => {
  const res = await fetchXAI(req); // your current xAI call
  return res.videoUrl; // or request_id if async
});
```

## Future Tools Ideas (pulled from toolchest)
- Face normalizer / best-frame selector (from face_swap ideas)
- Structured outfit / clothing prompting (inspired by 18-outfit-system)
- Lyrics / text overlay engine (20-lyrics-system)
- Audio feature extractor (beat grid, phoneme timestamps) for better prompting
- Quality scorer + auto-retry
- Background / lighting harmonization

This folder is meant to grow as our own private "VisualEssential Toolchest" but 100% under our control.
