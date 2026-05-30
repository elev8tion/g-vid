"""CLI entry point for xai-oauth-client."""

import argparse
import sys

from .client import XaiOAuthClient
from .storage import clear_tokens


def main():
    parser = argparse.ArgumentParser(
        prog="xai-oauth",
        description="xAI OAuth Client (SuperGrok)"
    )
    subparsers = parser.add_subparsers(dest="command")

    # Login
    login_p = subparsers.add_parser("login", help="Perform OAuth login with xAI")
    login_p.add_argument(
        "--no-browser", action="store_true",
        help="Do not attempt to open the browser automatically"
    )

    # Status
    subparsers.add_parser("status", help="Show current authentication status")

    # Logout
    subparsers.add_parser("logout", help="Clear stored tokens")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    client = XaiOAuthClient()

    if args.command == "login":
        client.login(open_browser=not args.no_browser)
    elif args.command == "status":
        if client.is_authenticated:
            print("✓ Authenticated with xAI (SuperGrok)")
            print(f"  Access token: {'present' if client.access_token else 'missing'}")
        else:
            print("✗ Not authenticated")
            print("  Run: xai-oauth login")
    elif args.command == "logout":
        clear_tokens()
        print("Tokens cleared.")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()