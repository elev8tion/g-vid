# xAI OAuth Client + Media Generation (SuperGrok)

Standalone client for xAI Grok OAuth with powerful image, video, and future audio generation capabilities.

This package replicates the authentication + media generation experience from Hermes Agent.

## Features

- **OAuth Authentication** (same flow as Hermes)
- **Image Generation** (`grok-imagine-image` and quality variant)
- **Video Generation** via xAI
- **Highly customizable** outputs (aspect ratio, resolution, style, negative prompts, etc.)
- Smart prompt enhancement

## Installation

```bash
cd xai-oauth-client
pip install -e .
```

Then use the CLI:

```bash
xai-oauth login
xai-oauth status
```

## Media Generation Example

```python
from xai_oauth import XaiOAuthClient, XaiMediaClient

oauth = XaiOAuthClient()
media = XaiMediaClient(oauth)

# Highly customizable image generation
result = media.generate_image(
    prompt="A cyberpunk samurai on a rainy neon street",
    model="grok-imagine-image-quality",
    aspect_ratio="16:9",
    resolution="2k",
    style="cinematic, volumetric lighting, Blade Runner aesthetic",
    negative_prompt="blurry, text, watermark",
)

print(result["url"])
```

## Supported Capabilities

| Feature              | Supported | Notes |
|----------------------|-----------|-------|
| Image Generation     | Yes       | `grok-imagine-image`, quality mode |
| Image Editing        | Partial   | Via `/images/edits` (if available) |
| Video Generation     | Yes       | `/videos/generations` |
| Audio (TTS)          | Planned   | Placeholder for future xAI support |
| Custom Styles        | Yes       | Pass rich style descriptions |
| Negative Prompts     | Yes       | Supported on image & video |

## Flexibility

The `XaiMediaClient` is designed so the model can "look within itself" — you can heavily influence the output through:

- `style` parameter (lighting, mood, art direction)
- `negative_prompt`
- Different models (speed vs quality)
- Resolution and aspect ratio
- Motion strength for video

This gives you fine-grained control similar to what you have inside Hermes.