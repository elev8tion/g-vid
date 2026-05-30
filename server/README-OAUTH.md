# Real xAI Device Code OAuth for g-vid

This backend now implements the **official xAI Device Authorization Grant** (RFC 8628) using the correct endpoints:

- Device code: `POST https://auth.x.ai/oauth2/device/code`
- Token poll:   `POST https://auth.x.ai/oauth2/token`

## Quick Start

1. Copy env:
   ```bash
   cp .env.example .env
   ```

2. Add `XAI_CLIENT_ID` to `.env` (required for real OAuth).

3. Start the backend:
   ```bash
   npm start
   # or npm run dev
   ```

4. In the React app, click **"Connect SuperGrok"** → the real flow will:
   - Call `/auth/device/start`
   - Show you a one-time code + direct link to `https://auth.x.ai/activate`
   - Poll the backend until you complete authorization in any browser
   - Receive a real access token and create a session

## Endpoints added

- `POST /auth/device/start` — initiates the device code request
- `GET  /auth/device/status?device_code=...` — backend polls xAI for you (secure)
- `GET  /auth/session/:sessionId` — returns connection status + basic profile
- `POST /auth/disconnect` — clears the session

## Notes

- The access token returned by xAI can be used as `Authorization: Bearer <token>` against `https://api.x.ai/v1` for supported endpoints.
- For full video generation, you will later proxy image references + the generated prompt through the backend using the stored token.
- Token storage is currently in-memory. Replace `tokenStore` with Redis + signed session cookies for production.
- The frontend automatically restores a valid session on reload if the token is still alive.

This replaces all previous mock "SuperGrok" buttons with a production-grade OAuth experience.