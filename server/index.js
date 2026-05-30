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
  const { prompt, shotName, trimStart, trimDuration, faceDescription, sessionId } = req.body;

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
      // Convert images to data URIs (for reference_images)
      const referenceImages = [];
      for (const f of imageFiles) {
        try {
          const buf = fs.readFileSync(f.path);
          const mime = f.mimetype || 'image/jpeg';
          referenceImages.push(`data:${mime};base64,${buf.toString('base64')}`);
        } catch (e) {
          console.warn('[Generate] failed to read image', f.originalname);
        }
      }

      // Audio as data URI (for lip-sync conditioning if supported by endpoint)
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

      const xaiPayload = {
        prompt: prompt || `Cinematic 8s music video performance in ${shotName || 'studio'}`,
        negative_prompt: 'text, watermark, logo, UI, blurry, low quality, artifacts, deformed, jitter, face mismatch',
        aspect_ratio: '16:9',
        duration,
        reference_images: referenceImages.length ? referenceImages : undefined,
        audio: audioDataUri || undefined,
        // Extra hints (harmless if ignored)
        face_description: faceDescription || undefined,
        shot_name: shotName || undefined,
      };

      console.log('[xAI] POST', VIDEO_GEN_URL, 'refs:', referenceImages.length, 'hasAudio:', !!audioDataUri, 'duration:', duration);

      const xaiRes = await fetch(VIDEO_GEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(xaiPayload),
      });

      console.log('[xAI] response status:', xaiRes.status);

      let xaiData = {};
      try {
        xaiData = await xaiRes.json();
      } catch {
        // non-json error body
      }

      if (!xaiRes.ok) {
        console.error('[xAI] generation error body:', xaiData);
        jobStore.set(jobId, {
          status: 'error',
          error: xaiData?.error?.message || xaiData?.message || `xAI HTTP ${xaiRes.status}`,
          createdAt: Date.now(),
        });
        cleanup();
        return;
      }

      // Parse possible response shapes (sync vs async job)
      let resultUrl = null;
      let xaiJobId = null;

      if (xaiData?.video?.url) resultUrl = xaiData.video.url;
      else if (xaiData?.data?.[0]?.url) resultUrl = xaiData.data[0].url;
      else if (xaiData?.url) resultUrl = xaiData.url;
      else if (xaiData?.result?.url) resultUrl = xaiData.result.url;

      if (!resultUrl) {
        xaiJobId = xaiData?.id || xaiData?.job_id || xaiData?.jobId || xaiData?.generation_id;
      }

      if (resultUrl) {
        jobStore.set(jobId, {
          status: 'done',
          resultUrl,
          createdAt: Date.now(),
        });
        console.log('[Generate] job', jobId, 'completed with direct video url');
      } else if (xaiJobId) {
        jobStore.set(jobId, {
          status: 'processing',
          xaiJobId,
          createdAt: Date.now(),
        });
        console.log('[Generate] job', jobId, 'xAI returned async job', xaiJobId, '— client will poll /jobs until extended poller implemented');
        // NOTE: for full async support, add a background poller here that GETs ${VIDEO_GEN_URL}/${xaiJobId} with Bearer and updates jobStore when done
      } else {
        // Unexpected success shape — treat as done with no url (frontend will see error)
        console.warn('[xAI] success but no recognized video url or job id in body:', Object.keys(xaiData));
        jobStore.set(jobId, {
          status: 'error',
          error: 'xAI returned success without video url or job id',
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
});
