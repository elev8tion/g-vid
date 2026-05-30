"""Main xAI OAuth client (PKCE flow + refresh)."""

import json
import time
import uuid
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import httpx

from .constants import (
    XAI_OAUTH_CLIENT_ID,
    XAI_OAUTH_DISCOVERY_URL,
    XAI_OAUTH_REDIRECT_HOST,
    XAI_OAUTH_REDIRECT_PATH,
    XAI_OAUTH_REDIRECT_PORT,
    XAI_OAUTH_SCOPE,
    XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS,
)
from .storage import load_full_state, load_tokens, save_tokens


class XaiOAuthError(Exception):
    """Custom exception for xAI OAuth errors."""


def _discover() -> Dict[str, str]:
    """Fetch OpenID configuration."""
    resp = httpx.get(XAI_OAUTH_DISCOVERY_URL, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    return {
        "authorization_endpoint": data["authorization_endpoint"],
        "token_endpoint": data["token_endpoint"],
    }


def _pkce_verifier() -> str:
    import secrets
    return secrets.token_urlsafe(64)


def _pkce_challenge(verifier: str) -> str:
    import hashlib
    import base64
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        self.server.callback_result = {k: v[0] for k, v in qs.items()}
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>Authorization complete. You can close this window.</h1>")

    def log_message(self, format, *args):
        pass  # silence


def _start_callback_server() -> Tuple[HTTPServer, Thread, Dict]:
    server = HTTPServer((XAI_OAUTH_REDIRECT_HOST, XAI_OAUTH_REDIRECT_PORT), _CallbackHandler)
    server.callback_result = {}
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    redirect_uri = f"http://{XAI_OAUTH_REDIRECT_HOST}:{XAI_OAUTH_REDIRECT_PORT}{XAI_OAUTH_REDIRECT_PATH}"
    return server, thread, {"redirect_uri": redirect_uri}


def _wait_for_callback(server: HTTPServer, timeout: float = 120) -> Dict[str, str]:
    start = time.time()
    while time.time() - start < timeout:
        if server.callback_result:
            server.shutdown()
            return server.callback_result
        time.sleep(0.5)
    server.shutdown()
    raise XaiOAuthError("Timeout waiting for OAuth callback")


class XaiOAuthClient:
    """High-level client for xAI OAuth."""

    def __init__(self):
        self.state = load_full_state()
        self.tokens = self.state.get("tokens", {})

    @property
    def access_token(self) -> Optional[str]:
        return self.tokens.get("access_token")

    @property
    def is_authenticated(self) -> bool:
        return bool(self.access_token)

    def login(self, open_browser: bool = True) -> None:
        """Perform the full OAuth login flow."""
        discovery = _discover()
        auth_url = discovery["authorization_endpoint"]
        token_url = discovery["token_endpoint"]

        code_verifier = _pkce_verifier()
        code_challenge = _pkce_challenge(code_verifier)
        state = uuid.uuid4().hex
        nonce = uuid.uuid4().hex

        redirect_uri = f"http://{XAI_OAUTH_REDIRECT_HOST}:{XAI_OAUTH_REDIRECT_PORT}{XAI_OAUTH_REDIRECT_PATH}"

        params = {
            "response_type": "code",
            "client_id": XAI_OAUTH_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "scope": XAI_OAUTH_SCOPE,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": state,
            "nonce": nonce,
        }

        auth_request_url = f"{auth_url}?{httpx.QueryParams(params)}"

        print("Open this URL to authorize with xAI:")
        print(auth_request_url)
        print()

        if open_browser:
            webbrowser.open(auth_request_url)

        server, thread, meta = _start_callback_server()
        try:
            callback = _wait_for_callback(server)
        finally:
            server.shutdown()

        if callback.get("error"):
            raise XaiOAuthError(f"OAuth error: {callback.get('error_description')}")

        if callback.get("state") != state:
            raise XaiOAuthError("State mismatch")

        code = callback.get("code")
        if not code:
            raise XaiOAuthError("Missing authorization code")

        # Exchange code for tokens
        token_resp = httpx.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "client_id": XAI_OAUTH_CLIENT_ID,
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
            },
            timeout=30,
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()

        self.tokens = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "id_token": token_data.get("id_token"),
            "token_type": token_data.get("token_type", "Bearer"),
            "expires_in": token_data.get("expires_in"),
            "last_refresh": datetime.now(timezone.utc).isoformat(),
        }

        save_tokens(self.tokens, discovery={"token_endpoint": token_url})
        print("✓ Successfully authenticated with xAI!")

    def refresh(self) -> None:
        """Refresh the access token using the refresh token."""
        refresh_token = self.tokens.get("refresh_token")
        if not refresh_token:
            raise XaiOAuthError("No refresh token available. Please login again.")

        discovery = self.state.get("discovery", {})
        token_url = discovery.get("token_endpoint") or _discover()["token_endpoint"]

        resp = httpx.post(
            token_url,
            data={
                "grant_type": "refresh_token",
                "client_id": XAI_OAUTH_CLIENT_ID,
                "refresh_token": refresh_token,
            },
            timeout=30,
        )

        if resp.status_code != 200:
            raise XaiOAuthError(f"Refresh failed: {resp.text}")

        data = resp.json()
        self.tokens["access_token"] = data["access_token"]
        if data.get("refresh_token"):
            self.tokens["refresh_token"] = data["refresh_token"]
        self.tokens["last_refresh"] = datetime.now(timezone.utc).isoformat()

        save_tokens(self.tokens, discovery={"token_endpoint": token_url})

    def ensure_valid_token(self, force_refresh: bool = False) -> None:
        """Make sure we have a valid, non-expired access token."""
        if not self.is_authenticated:
            raise XaiOAuthError("Not authenticated. Call .login() first.")

        # Simple heuristic: refresh if older than ~55 minutes
        last = self.tokens.get("last_refresh")
        if force_refresh or not last:
            self.refresh()
            return

        # More sophisticated expiry check can be added here
        # For now we rely on the 5-minute skew used in Hermes

    def get_auth_header(self) -> Dict[str, str]:
        self.ensure_valid_token()
        return {"Authorization": f"Bearer {self.access_token}"}