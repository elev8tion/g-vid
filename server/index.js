/**
 * g-vid Backend — xAI OAuth via Device Code + real Grok Video generation
 *
 * Endpoints:
 *   POST /auth/device/start    → initiates device code flow
 *   GET  /auth/device/status   → polls token endpoint until success
 *   GET  /auth/session/:id     → returns basic profile for a valid session (auto-refreshes)
 *   POST /auth/disconnect      → clears session
 *   POST /generate             → real multipart → xAI /videos/generations (returns {jobId})
 *   GET  /jobs/:id             → poll for {status, resultUrl?, error?}
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import fs from 'node:fs';
import sharp from 'sharp';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8787;
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// ============================================
// In-memory stores (replace with Redis/DB in production)
// ============================================
const tokenStore = new Map();        // sessionId → { accessToken, refreshToken, expiresAt, profile? }
const deviceFlowStore = new Map();   // device_code → { interval, expiresAt }
const jobStore = new Map();          // jobId → { status: 'processing'|'done'|'error', resultUrl?: string, error?: string, createdAt: number, xaiJobId?: string }

// xAI OAuth Device Code configuration (mirrors cre8-clips)
const XAI_ISSUER = process.env.XAI_OAUTH_ISSUER || 'https://auth.x.ai';
const DEVICE_CODE_URL = `${XAI_ISSUER}/oauth2/device/code`;
const TOKEN_URL = `${XAI_ISSUER}/oauth2/token`;
const DEFAULT_SCOPES = process.env.XAI_OAUTH_SCOPES || 'openid profile email offline_access grok-cli:access api:access';
// Hard-set to requested client ID; env override removed to prevent missing/empty configs
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';

const XAI_API_BASE = process.env.XAI_API_BASE || 'https://api.x.ai/v1';
const VIDEO_GEN_URL = `${XAI_API_BASE}/videos/generations`;
const VIDEO_STATUS_URL = (id) => `${XAI_API_BASE}/videos/${id}`;
const ENABLE_XAI_REFS = process.env.ENABLE_XAI_REFS === '1';

// Image compression settings for reference images (to keep payload size reasonable and avoid TLS errors)
const MAX_REF_IMAGE_LONG_EDGE = parseInt(process.env.MAX_REF_IMAGE_LONG_EDGE || '1024', 10);
const REF_IMAGE_JPEG_QUALITY = parseInt(process.env.REF_IMAGE_JPEG_QUALITY || '82', 10);
const XAI_VIDEO_MODEL = 'grok-imagine-video';

// ============================================
// Token helpers (refresh for /generate and session)
// ============================================
async function doRefresh(sessionId, tokenData) {
  if (!tokenData.refreshToken) {
    tokenStore.delete(sessionId);
    throw new Error('no_refresh_token');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenData.refreshToken,
    client_id: CLIENT_ID,
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await resp.json();
  if (!resp.ok || data.error || !data.access_token) {
    console.error('[OAuth] Refresh failed for', sessionId, data);
    tokenStore.delete(sessionId);
    throw new Error(data.error || 'refresh_failed');
  }
  const updated = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokenData.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    tokenType: data.token_type || 'Bearer',
  };
  tokenStore.set(sessionId, updated);
  console.log('[OAuth] Access token refreshed for session', sessionId);
  return updated;
}

async function getValidToken(sessionId) {
  let tokenData = tokenStore.get(sessionId);
  if (!tokenData?.accessToken) return null;
  const skew = 45_000; // 45s early refresh
  if (Date.now() > tokenData.expiresAt - skew) {
    if (!tokenData.refreshToken) {
      tokenStore.delete(sessionId);
      return null;
    }
    try {
      return await doRefresh(sessionId, tokenData);
    } catch {
      return null;
    }
  }
  return tokenData;
}

/**
 * Compresses an image buffer for use as a reference image.
 * Goals: Keep payload size reasonable to avoid TLS "bad record mac" errors,
 * while preserving enough detail for face/character consistency.
 */
async function compressImageForRef(buffer, originalMime = 'image/jpeg') {
  try {
    const image = sharp(buffer, { failOn: 'none' });

    // Resize so the longest edge is at most MAX_REF_IMAGE_LONG_EDGE
    const metadata = await image.metadata();
    const longEdge = Math.max(metadata.width || 0, metadata.height || 0);

    let pipeline = image;
    if (longEdge > MAX_REF_IMAGE_LONG_EDGE) {
      pipeline = pipeline.resize({
        width: MAX_REF_IMAGE_LONG_EDGE,
        height: MAX_REF_IMAGE_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Convert to JPEG at controlled quality (best size/quality tradeoff for faces)
    const compressedBuffer = await pipeline
      .jpeg({ quality: REF_IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    const base64 = compressedBuffer.toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  } catch (err) {
    console.warn('[Compress] Image compression failed, using original:', err.message);
    // Fallback: return original as-is (still better than crashing)
    const base64 = buffer.toString('base64');
    const mime = originalMime || 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  }
}

// Poll xAI video status endpoint until completion/failure
async function pollXaiVideoStatus(jobId, requestId, sessionId, attempt = 0) {
  const MAX_ATTEMPTS = 60; // ~5 minutes at 5s interval
  const DELAY_MS = 5000;

  try {
    const tokenData = await getValidToken(sessionId);
    if (!tokenData?.accessToken) {
      jobStore.set(jobId, { status: 'error', error: 'Session expired while polling xAI', createdAt: Date.now() });
      return;
    }

    const res = await fetch(VIDEO_STATUS_URL(requestId), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenData.accessToken}` },
    });

    let raw = '';
    let data = {};
    try {
      raw = await res.text();
      if (raw) {
        try { data = JSON.parse(raw); } catch { data = { raw }; }
      }
    } catch {
      raw = '(failed to read body)';
    }

    if (!res.ok) {
      console.error('[xAI status] non-2xx', res.status, raw || data);
      jobStore.set(jobId, { status: 'error', error: data?.error?.message || raw || `xAI status HTTP ${res.status}`, createdAt: Date.now() });
      return;
    }

    const status = data?.status || data?.state || data?.video?.status;
    const resultUrl = data?.video?.url || data?.url;

    if (resultUrl) {
      jobStore.set(jobId, { status: 'done', resultUrl, createdAt: Date.now() });
      console.log('[xAI status] job', jobId, 'completed with url');
      return;
    }

    if (status && ['failed', 'error', 'canceled'].includes(String(status).toLowerCase())) {
      jobStore.set(jobId, { status: 'error', error: data?.error?.message || `xAI reported ${status}`, createdAt: Date.now() });
      console.error('[xAI status] job', jobId, 'failed:', data);
      return;
    }

    if (attempt + 1 >= MAX_ATTEMPTS) {
      jobStore.set(jobId, { status: 'error', error: 'xAI video still processing (timeout)', createdAt: Date.now() });
      console.warn('[xAI status] job', jobId, 'timed out');
      return;
    }

    // keep polling
    setTimeout(() => {
      pollXaiVideoStatus(jobId, requestId, sessionId, attempt + 1).catch(err => {
        console.error('[xAI status] poller error for job', jobId, err);
        jobStore.set(jobId, { status: 'error', error: err.message || 'poller failed', createdAt: Date.now() });
      });
    }, DELAY_MS);
  } catch (err) {
    console.error('[xAI status] unexpected error for job', jobId, err);
    jobStore.set(jobId, { status: 'error', error: err.message || 'poller failed', createdAt: Date.now() });
  }
}

// ============================================
// Device Code Flow
// ============================================

app.post('/auth/device/start', async (_req, res) => {
  try {
    if (!CLIENT_ID) {
      return res.status(400).json({
        error: 'client_id_not_configured',
        error_description: 'XAI_CLIENT_ID is required. Set it in server/.env to use real OAuth.',
      });
    }

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: DEFAULT_SCOPES,
    });

    const response = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await response.json();
    if (!response.ok || data.error || !data.device_code) {
      console.error('[OAuth] Device code error:', data);
      return res.status(400).json({
        error: data.error || 'device_code_failed',
        error_description: data.error_description || 'Failed to start device authorization',
      });
    }

    const expiresAt = Date.now() + (data.expires_in || 900) * 1000;
    deviceFlowStore.set(data.device_code, {
      interval: data.interval || 5,
      expiresAt,
    });

    res.json({
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri || 'https://auth.x.ai/activate',
      verification_uri_complete: data.verification_uri_complete,
      expires_in: data.expires_in,
      interval: data.interval || 5,
    });
  } catch (err) {
    console.error('[OAuth] Device start failed:', err);
    res.status(500).json({
      error: 'oauth_unavailable',
      message: 'Could not reach xAI auth service. Real OAuth is not available.',
    });
  }
});

app.get('/auth/device/status', async (req, res) => {
  const { device_code } = req.query;

  if (!device_code) {
    return res.status(400).json({ error: 'missing_device_code' });
  }

  const flow = deviceFlowStore.get(device_code);
  if (!flow) {
    return res.status(404).json({ error: 'flow_not_found' });
  }

  if (Date.now() > flow.expiresAt) {
    deviceFlowStore.delete(device_code);
    return res.status(410).json({ error: 'expired' });
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code,
      client_id: CLIENT_ID,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error === 'authorization_pending') {
      return res.json({ status: 'pending' });
    }
    if (tokenData.error === 'slow_down') {
      return res.json({ status: 'slow_down', interval: (flow.interval || 5) + 2 });
    }
    if (tokenData.error) {
      console.error('[OAuth] Token error:', tokenData);
      return res.status(400).json({ status: 'error', error: tokenData.error });
    }

    if (tokenData.access_token) {
      const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);

      tokenStore.set(sessionId, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
        tokenType: tokenData.token_type || 'Bearer',
      });

      deviceFlowStore.delete(device_code);

      return res.json({
        status: 'authorized',
        sessionId,
        expires_in: tokenData.expires_in,
      });
    }

    res.json({ status: 'pending' });
  } catch (err) {
    console.error('[OAuth] Token poll failed:', err);
    res.status(500).json({ status: 'error', message: 'Token polling failed' });
  }
});

// ============================================
// Session + Disconnect
// ============================================
app.get('/auth/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const tokenData = await getValidToken(sessionId);

  if (!tokenData) {
    return res.status(401).json({ error: 'invalid_session' });
  }

  res.json({
    sessionId,
    connected: true,
    expiresAt: tokenData.expiresAt,
    plan: 'SuperGrok Heavy',
    credits: 1842, // placeholder — replace with real quota endpoint later
  });
});

app.post('/auth/disconnect', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) tokenStore.delete(sessionId);
  res.json({ ok: true });
});

// ============================================
// Real video generation (proxies to xAI with OAuth token)
// ============================================
app.post('/generate', upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  const { prompt, shotName, trimStart, trimDuration, faceDescription, sessionId, resolution: requestedResolution } = req.body;

  if (!sessionId) {
    return res.status(401).json({ error: 'session_id_required' });
  }

  const tokenData = await getValidToken(sessionId);
  if (!tokenData?.accessToken) {
    return res.status(401).json({ error: 'Not connected to SuperGrok', message: 'Session expired. Please reconnect.' });
  }

  const imageFiles = req.files?.images || [];
  const audioFile = (req.files?.audio || [])[0];

  console.log('[Generate] prompt len:', (prompt || '').length, 'shot:', shotName);
  console.log('[Generate] trim:', trimStart, trimDuration, 'face:', faceDescription ? 'yes' : 'no');
  console.log('[Generate] images:', imageFiles.length, 'audio:', !!audioFile);

  // Create job and return immediately so frontend can poll
  const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  jobStore.set(jobId, {
    status: 'processing',
    createdAt: Date.now(),
    sessionId,                    // store for token refresh during xAI status polling
  });

  // Respond fast
  res.json({ jobId, status: 'processing' });

  // Background: build payload with base64 refs + call xAI
  (async () => {
    const cleanup = () => {
      for (const f of imageFiles) { try { fs.unlinkSync(f.path); } catch {} }
      if (audioFile) { try { fs.unlinkSync(audioFile.path); } catch {} }
    };

    try {
      // Convert images to (optionally compressed) data URIs
      const referenceImages = [];
      for (const f of imageFiles) {
        try {
          const buf = fs.readFileSync(f.path);
          const mime = f.mimetype || 'image/jpeg';

          let finalDataUri;
          if (sendRefs) {
            // Auto-compress when sending references (prevents TLS "bad record mac" errors from huge payloads)
            const originalSize = buf.length;
            finalDataUri = await compressImageForRef(buf, mime);

            // Rough size comparison for logging
            const compressedSize = Math.round((finalDataUri.length * 3) / 4); // approximate decoded size
            console.log(`[Compress] ${f.originalname}: ${(originalSize / 1024).toFixed(0)} KB → ~${(compressedSize / 1024).toFixed(0)} KB`);
          } else {
            finalDataUri = `data:${mime};base64,${buf.toString('base64')}`;
          }

          referenceImages.push(finalDataUri);
        } catch (e) {
          console.warn('[Generate] failed to process image', f.originalname, e.message);
        }
      }

      // Audio as data URI (for audio_url reference when ENABLE_XAI_REFS=1)
      let audioDataUri = null;
      if (audioFile) {
        try {
          const buf = fs.readFileSync(audioFile.path);
          const mime = audioFile.mimetype || 'audio/mpeg';
          audioDataUri = `data:${mime};base64,${buf.toString('base64')}`;
        } catch (e) {
          console.warn('[Generate] failed to read audio');
        }
      }

      const duration = Math.max(4, Math.min(12, parseInt(trimDuration || '8', 10) || 8));

      // =====================================================
      // Payload normalization — prevents future deserialization 422s
      // =====================================================
      const normalizeVideoGenerationPayload = (raw) => {
        const allowedResolutions = ['480p', '720p', '1080p'];
        const allowedAspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'];
        const allowedDurations = [4, 8, 12];

        let resolution = allowedResolutions.includes(raw.requestedResolution)
          ? raw.requestedResolution
          : '720p';

        let aspect_ratio = allowedAspectRatios.includes(raw.aspect_ratio)
          ? raw.aspect_ratio
          : '16:9';

        let finalDuration = allowedDurations.includes(raw.duration)
          ? raw.duration
          : 8;

        return { resolution, aspect_ratio, duration: finalDuration };
      };

      const normalized = normalizeVideoGenerationPayload({
        requestedResolution,
        aspect_ratio: '16:9',
        duration,
      });

      // Payload for xAI Grok Imagine Video API (reference-to-video).
      // Uses Reference-to-Video mode when reference_images are provided.
      const xaiPayload = {
        model: XAI_VIDEO_MODEL,
        prompt: prompt || `Cinematic 8s music video performance in ${shotName || 'studio'}`,
        negative_prompt: 'text, watermark, logo, UI, blurry, low quality, artifacts, deformed, jitter, face mismatch',
        aspect_ratio: normalized.aspect_ratio,
        duration: normalized.duration,
        resolution: normalized.resolution,
      };

      // === REFERENCE IMAGES (Reference-to-Video mode) ===
      // Correct shape per xAI docs + automatic compression:
      //   "model": "grok-imagine-video"
      //   "reference_images": [ { "url": "data:image/jpeg;base64,..." (compressed) }, ... ]
      //
      // Images are resized (long edge controlled by MAX_REF_IMAGE_LONG_EDGE) and
      // JPEG-compressed at REF_IMAGE_JPEG_QUALITY to prevent huge payloads that
      // trigger "bad record mac" TLS errors.
      const sendRefs = ENABLE_XAI_REFS;
      if (sendRefs && referenceImages.length) {
        xaiPayload.reference_images = referenceImages.map(uri => ({ url: uri }));
      }
      if (sendRefs && faceDescription) xaiPayload.face_description = faceDescription;
      if (sendRefs && shotName) xaiPayload.shot_name = shotName;

      console.log('[xAI] POST', VIDEO_GEN_URL,
        'keys:', Object.keys(xaiPayload),
        'ref_images:', sendRefs ? referenceImages.length : 0,
        'duration:', xaiPayload.duration,
        'resolution:', xaiPayload.resolution,
        sendRefs ? '(reference_images attached — audio omitted for payload size)' : '(minimal payload)',
        `(user chose: ${requestedResolution || 'default'})`);

      // Extra safety log right before the actual call
      const payloadSize = Buffer.byteLength(JSON.stringify(xaiPayload), 'utf8');
      console.log('[xAI] >>> Sending to xAI with resolution =', xaiPayload.resolution, ' (this must NOT be "1k")', `payload size ≈ ${(payloadSize / 1024).toFixed(0)} KB`);

      if (sendRefs) {
        console.log('[xAI] Refs payload shape:',
          'reference_images=', xaiPayload.reference_images ? xaiPayload.reference_images.length + ' items (auto-compressed)' : 'none'
        );
      }

      let xaiRes;
      try {
        xaiRes = await fetch(VIDEO_GEN_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(xaiPayload),
        });
      } catch (fetchErr) {
        // Catch low-level network/TLS errors (e.g. "bad record mac" from huge base64 payloads)
        console.error('[xAI] Network/TLS error during request:', fetchErr.message);
        jobStore.set(jobId, {
          status: 'error',
          error: `Network/TLS error calling xAI: ${fetchErr.message}. This is usually caused by very large base64 image payloads. Try disabling refs (or using fewer/smaller photos) and rely on the detailed prompt for lip-sync.`,
          createdAt: Date.now(),
        });
        cleanup();
        return;
      }

      console.log('[xAI] response status:', xaiRes.status);

      // Always capture the *raw* body on non-2xx (xAI sometimes returns 422 with empty {}
      // or a plain text error; .json() alone hid the real message in the last 422).
      let rawBody = '';
      let xaiData = {};
      try {
        rawBody = await xaiRes.text();
        if (rawBody) {
          try { xaiData = JSON.parse(rawBody); } catch { xaiData = { raw: rawBody }; }
        }
      } catch (e) {
        rawBody = '(failed to read body)';
      }

      if (!xaiRes.ok) {
        console.error('[xAI] non-2xx raw body:', rawBody || xaiData);
        console.error('[xAI] parsed:', xaiData);
        jobStore.set(jobId, {
          status: 'error',
          error: xaiData?.error?.message || xaiData?.message || rawBody || `xAI HTTP ${xaiRes.status}`,
          createdAt: Date.now(),
        });
        cleanup();
        return;
      }

      // xAI video API is always async for generation.
      // Successful submit returns { "request_id": "..." }
      const xaiRequestId = xaiData?.request_id;

      if (xaiRequestId) {
        // Store the xAI request id so our /jobs poller (or this background task) can check status
        jobStore.set(jobId, {
          status: 'processing',
          xaiRequestId,
          sessionId,           // for refreshing the token when polling status
          createdAt: Date.now(),
        });
        console.log('[Generate] job', jobId, 'submitted to xAI as request_id', xaiRequestId);

        // Background poll the xAI status endpoint until done/failed
        pollXaiVideoStatus(jobId, xaiRequestId, sessionId).catch(err => {
          console.error('[Generate] background xAI status poller failed for job', jobId, err);
        });

      } else {
        // Unexpected response shape
        console.warn('[xAI] success but no request_id. keys:', Object.keys(xaiData), 'sample:', JSON.stringify(xaiData).slice(0, 400));
        jobStore.set(jobId, {
          status: 'error',
          error: 'Unexpected response from xAI video API (no request_id)',
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      console.error('[xAI] call failed:', err);
      jobStore.set(jobId, {
        status: 'error',
        error: err.message || 'xAI request failed',
        createdAt: Date.now(),
      });
    } finally {
      cleanup();
    }
  })();
});

// ============================================
// Job status polling (for async or long-running xAI video jobs)
// ============================================
app.get('/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'job_not_found' });
  }
  // Optional: could attempt xAI status poll here if job.xaiJobId present + we stored a session ref
  res.json({
    jobId,
    status: job.status,
    resultUrl: job.resultUrl || null,
    error: job.error || null,
  });
});

app.get('/health', (req, res) => res.json({ ok: true, oauth: 'device_code', backend: BACKEND_URL }));

app.listen(PORT, () => {
  console.log(`g-vid backend (device code OAuth) running on ${BACKEND_URL}`);
  if (!CLIENT_ID) {
    console.log('  ⚠️  XAI_CLIENT_ID not set — real OAuth is disabled until configured.');
  }
  console.log('  Video resolution policy: only 480p / 720p / 1080p are accepted (old "1k"/"2k" values will be normalized to 720p)');
  console.log(`  Image compression (refs): long edge ≤ ${MAX_REF_IMAGE_LONG_EDGE}px @ quality ${REF_IMAGE_JPEG_QUALITY}`);
  console.log('  Tip: Use `npm run dev` in the server folder for hot-reload during development (prevents stale code bugs like this)');
});
