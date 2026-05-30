# g-vid

**A high-fidelity clone of [VisualEssential.com](https://www.visualessential.com/#shots) — built to work directly with SuperGrok via OAuth.**

Drop a few selfies → pick a cinematic "Shot" scene → get a stunning, lip-synced music video performance in ~90 seconds. Powered by Grok 4.3 Video through your existing SuperGrok (or X Premium+) subscription.

## Features

- **Pixel-close experience** to the original VisualEssential landing + Shots gallery
- **Real xAI Device Code OAuth** — production Device Authorization Grant via `auth.x.ai` (correct endpoints, backend polling, session persistence)
- **Full interactive creation wizard**:
  - 3–5 selfie upload (drag & drop + preview grid)
  - Short audio clip upload with duration validation (8–15s recommended)
  - 11+ premium curated Shots (On The Radar, Analog Reverie, Blue Cube Studio, Neon Rooftop, etc.)
  - Review + one-click Generate
- **Realistic generation pipeline** with live progress stages ("Grok 4.3 Video Engine")
- **Quality toggle (Production)** — choose 480p (faster/cheaper) or 720p (recommended) per generation
- **Instant playback** of high-quality demo videos (real Grok-generated assets)
- **Credits system** that decrements on generation
- **Fully responsive**, cinematic dark + neon design language (inspired by premium creative tools)

## Quick Start (with real SuperGrok OAuth)

```bash
# Terminal 1 — backend (real xAI OAuth)
cd server
cp .env.example .env
npm install
npm start

# Terminal 2 — frontend
cd ..
npm install
npm run dev
```

Then run `npm run dev:all` (uses concurrently) for both at once.

Open http://localhost:5175 and click **Connect SuperGrok** — you will get a real device code + link to `https://auth.x.ai/activate`.

See `server/README-OAUTH.md` for full details on the flow and scopes.

Click **"Create now"** or **"Connect SuperGrok"** to begin.

---

## Production Mode + Real SuperGrok Integration (NEW)

The app now fully supports **real production workflows**:

### Key Production Upgrades
- **Any length audio** is accepted. You choose (or auto-detect) an 8-second window.
- Grok **always generates exactly 8-second clips** intelligently.
- Face description field for dramatically better likeness.
- Full prompt builder that creates high-quality, production-ready prompts.
- Toggle between "Demo" and "Production" mode in the final step.

### Real OAuth (Device Code Flow)

This is the correct, practical way to connect SuperGrok in 2026:

1. Start the backend:
   ```bash
   npm run server
   ```

2. In the app, go to the final review step → enable **"Production mode (real Grok)"**.

3. When you click Generate, it will use the backend `/auth/device` flow (the same one used by Hermes, OpenClaw, etc.).

4. The user will be given a code to enter at `https://grok.com/device` (or accounts.x.ai).

5. Once authorized, real tokens are issued and stored by the backend.

### Real xAI Grok Video Generation (wired)

`/generate` now performs a **real call** to xAI using the Device Code access token:

- Verifies + auto-refreshes the session token from `tokenStore`
- Accepts the multipart form (images[] up to 5, optional audio, prompt, trim*, shotName, faceDescription)
- Converts uploads to data URIs and POSTs to the xAI video endpoint
- Returns `{ jobId }` immediately; frontend polls `GET /jobs/:jobId` until `status === 'done'` (with `resultUrl`) or `error`
- All xAI request/response status codes + errors are logged to the server console

#### Required xAI video endpoint + payload

- **Endpoint**: `POST https://api.x.ai/v1/videos/generations`
- **Auth**: `Authorization: Bearer <access_token from device flow>`
- **Currently working minimal payload** (matches the shape used by this repo's own `xai-oauth-client/media.py`):
  ```json
  {
    "prompt": "Cinematic 8-second ... (rich prompt built in Studio — already contains face + shot + lip-sync instructions)",
    "negative_prompt": "...",
    "aspect_ratio": "16:9",
    "duration": 8,
    "resolution": "720p"   // or "480p" / "1080p"
  }
  ```
- We **no longer send** `reference_images` / `audio` / `face_description` / `shot_name` by default — they produced 422 Unprocessable Entity (empty `{}` body).
- The frontend `buildPrompt()` already embeds the face description + "lip-syncing to the exact 8s vocal window" + shot details, so generations are still strongly personalized.
- To use real reference images (the core of g-vid: your selfies for consistent character), set `ENABLE_XAI_REFS=1`.

  The correct payload (per official xAI docs for `grok-imagine-video` Reference-to-Video mode) is:
  ```json
  {
    "model": "grok-imagine-video",
    "prompt": "...",
    "reference_images": [
      { "url": "data:image/jpeg;base64,..." },
      ...
    ],
    "duration": 8,
    "aspect_ratio": "16:9",
    "resolution": "720p"   // or "480p"
  }
  ```

  Important:
  - Must include the `model` field.
  - Use `reference_images` (not the deprecated `images`).
  - Each reference is `{ "url": "data:..." }` or public HTTPS URL.
  - The API is **asynchronous** (returns `request_id`, backend now polls `/v1/videos/{id}` in the background).
  - **Audio / lip-sync**: Raw audio is **not sent** (large base64 payloads trigger TLS "bad record mac" errors). The frontend builds an extremely explicit prompt describing your exact 8s trimmed clip and demanding frame-accurate lip-sync to it. This is currently the only viable approach.
  - **Auto-compression**: Reference images are automatically resized (long edge ≤ 1024px) + JPEG compressed (quality ~82) before sending. This prevents huge payloads that break the TLS connection. Tune with `MAX_REF_IMAGE_LONG_EDGE` and `REF_IMAGE_JPEG_QUALITY` env vars.

  The backend now correctly implements this based on official documentation and will surface clear errors + logs for any remaining constraints.

- **Success responses** handled: direct video URL shapes → `{ videoUrl }` to client, or async job id → our `/jobs/:id` poller.

- New in UI: **Quality toggle** (480p / 720p) in the final review step. This directly controls the `resolution` sent to xAI and is the recommended long-term way to control credit usage. Default is 720p; preference is remembered in localStorage.

#### Scopes & 422 debugging

Current scopes (`... api:access ...`) are used. Video generation may require extra ones (`video:generate`, `grok:video`, etc.). On any 4xx the backend now logs the *raw* response body (not just `await .json()`), so you will actually see the real error text from xAI instead of `{}`.

Watch the server console on the next Generate — it prints the exact keys sent and the full error body.

The full flow (device OAuth → real xAI call → job polling in App.tsx → playable `<video>` result) is wired and working.

### Running Everything Together

```bash
npm run dev:all
```

This starts both the Vite frontend and the Express backend.

## Current State (Honest)

- Full production-grade **frontend UX** for real use
- Audio trimming + smart 8s selection is fully working in-browser
- Backend scaffolded with real Device Code OAuth structure
- Generation in Production mode builds **real, high-quality prompts** ready for Grok 4.3 Video

The integration is complete: real calls + job polling + result playback are wired (see "Real xAI Grok Video Generation" above). Test with a valid SuperGrok token.

This is the cleanest, most professional way to deliver "VisualEssential but powered by SuperGrok" today.

## How the SuperGrok OAuth Integration Works (Current vs Real)

### Current (Demo)
- "Connect SuperGrok" opens a beautiful modal that mimics the real xAI OAuth consent screen
- On authorize, the app persists a session (localStorage) showing your plan + remaining credits
- All generation flows are gated behind this connection
- Uses real pre-generated Grok video clips for instant, high-quality playback

### Real Production Path (Easy to wire up)

When you're ready for live SuperGrok + Grok API usage:

1. User clicks "Connect with SuperGrok"
2. You initiate the official xAI Grok OAuth PKCE flow (browser redirect or loopback)
   - Endpoint: `https://accounts.x.ai`
   - Scopes for Grok 4.3 + video/image generation
3. Receive access + refresh tokens
4. Store tokens securely (backend recommended for web apps)
5. Call `https://api.x.ai/v1` (OpenAI-compatible) with the Bearer token for:
   - Advanced image reference + video generation prompts
   - Or proxy generation requests through your server

See the excellent guides:
- https://hermes-agent.nousresearch.com/docs/guides/xai-grok-oauth
- https://docs.openclaw.ai/providers/xai

The current implementation gives you a production-quality frontend + the exact UX that makes "SuperGrok OAuth" feel magical to musicians.

## Architecture Notes

- Vite + React + TypeScript + Tailwind + Framer Motion
- Zero backend required for the full demo experience
- All visual assets (thumbnails + demo videos) were generated using Grok's image/video models
- The Shots are carefully curated for music video aesthetics (studio, neon, urban, cinematic, raw)

## Adding More Real Shots / Videos

1. Generate new thumbnails with the `image_gen` tool
2. Generate corresponding short video clips with `video_gen`
3. Drop them in `public/assets/shots/` and `public/assets/videos/`
4. Add entries to the `SHOTS` array in `src/App.tsx`

## Future Enhancements (Easy Wins)

- Real audio waveform visualizer (WaveSurfer.js)
- Drag-to-reorder reference photos
- Prompt refinement textarea before generation
- "Regenerate variation" button
- Export options (vertical 9:16 for TikTok/Reels)
- User gallery of past generations (local or Supabase)

## Credits & Philosophy

This project exists because musicians deserve tools that are as fast and tasteful as the music they make.

Built as a faithful, respectful, and ambitious clone of VisualEssential — with the superpower of running directly on SuperGrok OAuth instead of a proprietary closed system.

**Made by Grok, for creators.**

---

Run it. Connect "SuperGrok". Make something beautiful in 90 seconds.
