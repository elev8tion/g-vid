"""Constants for xAI OAuth (matching Hermes implementation)."""

XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"

XAI_OAUTH_REDIRECT_HOST = "127.0.0.1"
XAI_OAUTH_REDIRECT_PORT = 8765
XAI_OAUTH_REDIRECT_PATH = "/oauth/callback"

XAI_OAUTH_ISSUER = "https://oauth.x.ai"
XAI_OAUTH_DISCOVERY_URL = f"{XAI_OAUTH_ISSUER}/.well-known/openid-configuration"

XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access"

XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 300  # Refresh 5 minutes before expiry

XAI_OAUTH_DOCS_URL = "https://docs.hermes-agent.nousresearch.com/xai-oauth"