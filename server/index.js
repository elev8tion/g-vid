/**
 * g-vid Backend — xAI OAuth via Device Code (matches cre8-clips pattern)
 *
 * Endpoints:
 *   POST /auth/device/start    → initiates device code flow
 *   GET  /auth/device/status   → polls token endpoint until success
 *   GET  /auth/session/:id     → returns basic profile for a valid session
 *   POST /auth/disconnect      → clears session
 *   POST /generate             → stub for generation (requires session)
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { URLSearchParams } from 'url';

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

// xAI OAuth Device Code configuration (mirrors cre8-clips)
const XAI_ISSUER = process.env.XAI_OAUTH_ISSUER || 'https://auth.x.ai';
const DEVICE_CODE_URL = `${XAI_ISSUER}/oauth2/device/code`;
const TOKEN_URL = `${XAI_ISSUER}/oauth2/token`;
const DEFAULT_SCOPES = process.env.XAI_OAUTH_SCOPES || 'openid profile email offline_access grok-cli:access api:access';
// Hard-set to requested client ID; env override removed to prevent missing/empty configs
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';

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
app.get('/auth/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const tokenData = tokenStore.get(sessionId);

  if (!tokenData) {
    return res.status(401).json({ error: 'invalid_session' });
  }

  if (Date.now() > tokenData.expiresAt) {
    tokenStore.delete(sessionId);
    return res.status(401).json({ error: 'session_expired' });
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
// Generation stub
// ============================================
app.post('/generate', upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  const { prompt, shotName, trimStart, trimDuration, faceDescription, sessionId } = req.body;

  if (!sessionId) {
    return res.status(401).json({ error: 'session_id_required' });
  }

  const tokenData = tokenStore.get(sessionId);
  if (!tokenData?.accessToken) {
    return res.status(401).json({ error: 'Not connected to SuperGrok' });
  }

  const images = (req.files?.images || []).map((file) => ({ filename: file.filename, original: file.originalname, size: file.size }));
  const audio = (req.files?.audio || [])[0];

  console.log('[Generate] prompt:', prompt);
  console.log('[Generate] shot:', shotName);
  console.log('[Generate] trim:', trimStart, trimDuration);
  console.log('[Generate] face description:', faceDescription);
  console.log('[Generate] images uploaded:', images.length);
  console.log('[Generate] audio uploaded:', !!audio);

  res.json({
    status: 'prompt_accepted',
    prompt,
    shot: shotName,
    faceDescription,
    estimatedCredits: 52,
    message: 'Prompt accepted and queued. In production this would proxy the request to xAI video generation.',
  });
});

app.get('/health', (req, res) => res.json({ ok: true, oauth: 'device_code', backend: BACKEND_URL }));

app.listen(PORT, () => {
  console.log(`g-vid backend (device code OAuth) running on ${BACKEND_URL}`);
  if (!CLIENT_ID) {
    console.log('  ⚠️  XAI_CLIENT_ID not set — real OAuth is disabled until configured.');
  }
});
