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
import path from 'node:path';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8787;
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Serve generated videos with replaced audio
const GENERATED_DIR = path.join(process.cwd(), 'generated');
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}
app.use('/generated', express.static(GENERATED_DIR, { maxAge: '1h' }));

// ============================================
// In-memory stores (replace with Redis/DB in production)
// ============================================
const tokenStore = new Map();        // sessionId → { accessToken, refreshToken, expiresAt, profile? }
const deviceFlowStore = new Map();   // device_code → { interval, expiresAt }
const jobStore = new Map();          // jobId → { status: 'processing'|'done'|'error', resultUrl?: string, error?: string, createdAt: number, xaiJobId?: string }

// Dev-only: persist sessions across restarts so you don't have to re-connect constantly while testing.
// File is gitignored. Completely safe to delete.
const DEV_SESSIONS_FILE = path.join(process.cwd(), '.dev-sessions.json'); // lives next to .env in server/ folder

function loadDevSessions() {
  if (process.env.NODE_ENV === 'production') return;
  try {
    if (fs.existsSync(DEV_SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEV_SESSIONS_FILE, 'utf8'));
      for (const [sid, val] of Object.entries(data)) {
        // Only restore non-expired sessions
        if (val.expiresAt && Date.now() < val.expiresAt) {
          tokenStore.set(sid, val);
        }
      }
      if (tokenStore.size > 0) {
        console.log(`[Dev] Restored ${tokenStore.size} session(s) from ${DEV_SESSIONS_FILE}`);
      }
    }
  } catch (e) {
    console.warn('[Dev] Could not load dev sessions:', e.message);
  }
}

function saveDevSessions() {
  if (process.env.NODE_ENV === 'production') return;
  try {
    const obj = Object.fromEntries(tokenStore);
    fs.writeFileSync(DEV_SESSIONS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn('[Dev] Could not save dev sessions:', e.message);
  }
}

// Load persisted sessions on startup
loadDevSessions();

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

// Image compression settings for reference images.
// Goal: Preserve as much face detail as possible for good reference-to-video results
// while keeping the total JSON payload small enough to avoid TLS "bad record mac" errors.
const MAX_REF_IMAGE_LONG_EDGE = parseInt(process.env.MAX_REF_IMAGE_LONG_EDGE || '1280', 10);
const REF_IMAGE_JPEG_QUALITY = parseInt(process.env.REF_IMAGE_JPEG_QUALITY || '88', 10);
const XAI_VIDEO_MODEL = 'grok-imagine-video';

// Toolchest pipeline (pre/post interceptors around xAI calls) — using dynamic import because server is ESM
const toolchest = await import('../toolchest/index.js');

const parseFlag = (value, defaultValue = true) => {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return !(lower === 'false' || lower === '0' || lower === 'off');
  }
  return Boolean(value);
};

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
  saveDevSessions(); // persist for dev restarts
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
      const existingJob = jobStore.get(jobId) || {};
      let finalUrl = resultUrl;

      // Run post-interceptors (with per-request toggles) against the returned video URL
      try {
        const flags = existingJob.pipelineFlags || {};
        const postPipeline = toolchest.buildPipeline({
          enableAudioAnalysis: flags.enableAudioAnalysis ?? true,
          enablePromptEnhancer: flags.enablePromptEnhancer ?? true,
          enableAudioReplace: flags.enableAudioReplace ?? true,
        });

        const postContext = {
          ...existingJob,
          jobId,
          audioPath: existingJob.originalAudioPath || existingJob.audioPath,
        };

        const { videoUrl: processedUrl, steps: postSteps } = await postPipeline.runPost(finalUrl, postContext);
        finalUrl = processedUrl;

        const finalSteps = [
          ...(existingJob.steps || []),
          ...postSteps,
          { name: 'done', status: 'completed' },
        ];

        jobStore.set(jobId, {
          ...existingJob,
          status: 'done',
          resultUrl: finalUrl,
          createdAt: Date.now(),
          steps: finalSteps,
        });
        console.log('[xAI status] job', jobId, 'completed with url', finalUrl);
      } catch (postErr) {
        console.error('[Poller] Post-processing failed:', postErr);
        jobStore.set(jobId, {
          ...existingJob,
          status: 'error',
          error: {
            stage: postErr?.stage || 'post',
            interceptor: postErr?.interceptor,
            message: postErr?.message || 'post_processing_failed',
          },
          createdAt: Date.now(),
        });
      }
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

      saveDevSessions(); // persist for dev restarts

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
  saveDevSessions(); // keep persisted file in sync
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

  const pipelineFlags = {
    enableAudioAnalysis: parseFlag(req.body.enableAudioAnalysis, true),
    enablePromptEnhancer: parseFlag(req.body.enablePromptEnhancer, true),
    enableAudioReplace: parseFlag(req.body.enableAudioReplace, true),
  };
  const pipelineInstance = toolchest.buildPipeline(pipelineFlags);

  const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

  // If audio was uploaded, preserve it for later audio replacement (muxing)
  let preservedAudioPath = null;
  if (audioFile) {
    const ext = path.extname(audioFile.originalname) || '.mp3';
    preservedAudioPath = path.join(GENERATED_DIR, `${jobId}-original-audio${ext}`);
    fs.copyFileSync(audioFile.path, preservedAudioPath);
  }

  const cleanup = () => {
    for (const f of imageFiles) { try { fs.unlinkSync(f.path); } catch {} }
    if (audioFile) { try { fs.unlinkSync(audioFile.path); } catch {} }
  };

  const sendRefs = ENABLE_XAI_REFS;

  try {
    // Convert images to (optionally compressed) data URIs
    const referenceImages = [];
    for (const f of imageFiles) {
      try {
        const buf = fs.readFileSync(f.path);
        const mime = f.mimetype || 'image/jpeg';

        let finalDataUri;
        if (sendRefs) {
          const originalSize = buf.length;
          finalDataUri = await compressImageForRef(buf, mime);
          const compressedSize = Math.round((finalDataUri.length * 3) / 4);
          console.log(`[Compress] ${f.originalname}: ${(originalSize / 1024).toFixed(0)} KB → ~${(compressedSize / 1024).toFixed(0)} KB`);
        } else {
          finalDataUri = `data:${mime};base64,${buf.toString('base64')}`;
        }

        referenceImages.push(finalDataUri);
      } catch (e) {
        console.warn('[Generate] failed to process image', f.originalname, e.message);
      }
    }

    console.log('[Generate] Prepared referenceImages count:', referenceImages.length);

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

    let xaiPayload = {
      model: XAI_VIDEO_MODEL,
      prompt: prompt || `Cinematic 8s music video performance in ${shotName || 'studio'}`,
      negative_prompt: 'text, watermark, logo, UI, blurry, low quality, artifacts, deformed, jitter, face mismatch',
      aspect_ratio: normalized.aspect_ratio,
      duration: normalized.duration,
      resolution: normalized.resolution,
    };

    const generationContext = {
      jobId,
      sessionId,
      originalPrompt: prompt,
      referenceImages: sendRefs ? referenceImages : [],
      audioPath: preservedAudioPath || undefined,
      shot: { id: shotName, name: shotName, description: '', promptHint: '' },
      faceDescription,
      trimWindow: { start: parseFloat(trimStart) || 0, duration: parseFloat(trimDuration) || 8 },
    };

    let preSteps = [];
    try {
      const preResult = await pipelineInstance.runPre(xaiPayload, generationContext);
      xaiPayload = preResult.request;
      preSteps = preResult.steps;
      console.log('[Toolchest] Pre steps completed:', preSteps.map(s => s.name).join(' → '));
    } catch (err) {
      cleanup();
      if (err instanceof toolchest.PipelineInterceptorError) {
        return res.status(400).json({
          error: 'pre_interceptor_failed',
          details: { stage: err.stage, interceptor: err.interceptor, message: err.message },
        });
      }
      console.error('[Toolchest] Pre-interceptor error:', err);
      return res.status(500).json({ error: 'pre_interceptor_failed', message: err?.message || 'Pre-processing failed' });
    }

    jobStore.set(jobId, {
      status: 'processing',
      createdAt: Date.now(),
      sessionId,
      originalAudioPath: preservedAudioPath,
      steps: preSteps,
      pipelineFlags,
    });

    // Respond only after pre-processing succeeded
    res.json({ jobId, status: 'processing' });

    // Background: call xAI
    (async () => {
      try {
        if (sendRefs && referenceImages.length) {
          xaiPayload.reference_images = referenceImages.map(uri => ({ url: uri }));
        }
        if (sendRefs && faceDescription) xaiPayload.face_description = faceDescription;
        if (sendRefs && shotName) xaiPayload.shot_name = shotName;
        if (sendRefs && audioDataUri) xaiPayload.audio = audioDataUri;

        const payloadSize = Buffer.byteLength(JSON.stringify(xaiPayload), 'utf8');
        console.log('============================================================');
        console.log('[xAI] FINAL PAYLOAD SUMMARY BEFORE SENDING');
        console.log('  ENABLE_XAI_REFS active :', sendRefs);
        console.log('  Model                  :', xaiPayload.model);
        console.log('  Reference images       :', xaiPayload.reference_images ? xaiPayload.reference_images.length : 0, '(auto-compressed)');
        console.log('  Audio included         :', !!xaiPayload.audio, '(raw user audio is deliberately omitted — lip-sync is prompt-only)');
        console.log('  Prompt length          :', (xaiPayload.prompt || '').length, 'chars');
        console.log('  Total payload size     :', (payloadSize / 1024).toFixed(0), 'KB');
        console.log('  Keys being sent        :', Object.keys(xaiPayload).join(', '));
        console.log('============================================================');

        if (sendRefs && xaiPayload.reference_images && xaiPayload.reference_images.length > 0) {
          console.log('>>> REF IMAGES ARE BEING SENT TO XAI IN THIS REQUEST <<<');
        } else {
          console.log('>>> NO REFERENCE IMAGES ATTACHED — prompt-only mode <<<');
        }

        console.log('[xAI] POST', VIDEO_GEN_URL,
          'ref_images:', xaiPayload.reference_images ? xaiPayload.reference_images.length : 0,
          'duration:', xaiPayload.duration,
          'resolution:', xaiPayload.resolution,
          `(user chose: ${requestedResolution || 'default'})`);

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

        console.log('[xAI] Response keys from xAI:', Object.keys(xaiData));

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

        const xaiRequestId = xaiData?.request_id;

        if (xaiRequestId) {
          const existingJob = jobStore.get(jobId) || {};
          jobStore.set(jobId, {
            ...existingJob,
            status: 'processing',
            xaiRequestId,
            sessionId,
            createdAt: Date.now(),
            steps: existingJob.steps || preSteps,
          });
          console.log('[Generate] job', jobId, 'submitted to xAI as request_id', xaiRequestId);

          pollXaiVideoStatus(jobId, xaiRequestId, sessionId).catch(err => {
            console.error('[Generate] background xAI status poller failed for job', jobId, err);
          });

        } else {
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
  } catch (err) {
    cleanup();
    console.error('[Generate] failed to start generation:', err);
    return res.status(500).json({ error: 'generate_failed', message: err?.message || 'Failed to start generation' });
  }
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
    steps: job.steps || [],
  });
});

app.get('/health', (req, res) => res.json({ ok: true, oauth: 'device_code', backend: BACKEND_URL }));

app.listen(PORT, () => {
  console.log(`g-vid backend (device code OAuth) running on ${BACKEND_URL}`);
  if (!CLIENT_ID) {
    console.log('  ⚠️  XAI_CLIENT_ID not set — real OAuth is disabled until configured.');
  }
  console.log('  Video resolution policy: only 480p / 720p / 1080p are accepted (old "1k"/"2k" values will be normalized to 720p)');
  console.log(`  Image compression (refs): long edge ≤ ${MAX_REF_IMAGE_LONG_EDGE}px @ quality ${REF_IMAGE_JPEG_QUALITY} (tune with MAX_REF_IMAGE_LONG_EDGE / REF_IMAGE_JPEG_QUALITY)`);
  console.log('  Tip: Use `npm run dev` in the server folder for hot-reload during development (prevents stale code bugs like this)');
});

// Dev-only: persist sessions on shutdown so you don't lose your login on every restart during testing.
process.on('SIGINT', () => { saveDevSessions(); process.exit(0); });
process.on('SIGTERM', () => { saveDevSessions(); process.exit(0); });
process.on('beforeExit', saveDevSessions);
