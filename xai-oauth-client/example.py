"""Example usage of the xAI OAuth client."""

from xai_oauth.client import XaiOAuthClient
import httpx

def main():
    client = XaiOAuthClient()

    if not client.is_authenticated:
        print("No tokens found. Running login flow...")
        client.login()

    # Ensure we have a fresh token
    client.ensure_valid_token()

    headers = client.get_auth_header()
    headers["Content-Type"] = "application/json"

    # Example call to Grok
    payload = {
        "model": "grok-4.3",
        "messages": [
            {"role": "user", "content": "Say hello in exactly 5 words."}
        ],
        "max_tokens": 20,
    }

    resp = httpx.post(
        "https://api.x.ai/v1/chat/completions",
        headers=headers,
        json=payload,
        timeout=60,
    )

    print("Status:", resp.status_code)
    print(resp.json())


if __name__ == "__main__":
    main()