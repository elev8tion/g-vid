"""
Advanced Media Generation Client for xAI (Grok Imagine)

Supports:
- Image generation (grok-imagine-image, grok-imagine-image-quality)
- Video generation
- Highly customizable outputs

The client reuses the OAuth token from XaiOAuthClient.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any, Dict, Literal, Optional

import httpx

from .client import XaiOAuthClient
from .constants import XAI_OAUTH_CLIENT_ID

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

XAI_BASE_URL = "https://api.x.ai/v1"

# Image models
IMAGE_MODELS = {
    "grok-imagine-image": {"speed": "fast", "quality": "standard"},
    "grok-imagine-image-quality": {"speed": "slower", "quality": "high"},
}

# Supported aspect ratios
ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]

# Supported resolutions
# - Video (/videos/generations): "480p", "720p", "1080p"
# - Image  (/images/generations): may still use "1k", "2k" depending on model
RESOLUTIONS = ["480p", "720p", "1080p"]

# Video durations (in seconds)
VIDEO_DURATIONS = [4, 8, 12]


class XaiMediaClient:
    """
    Flexible and powerful media generation client for xAI.

    Designed to be highly customizable. You can control:
    - Model choice (standard vs quality)
    - Aspect ratio, resolution
    - Style, mood, lighting via prompt engineering
    - Negative prompts (where supported)
    - Output format (URL vs base64)
    """

    def __init__(self, oauth_client: Optional[XaiOAuthClient] = None):
        self.oauth = oauth_client or XaiOAuthClient()
        self._client = httpx.Client(timeout=180.0)

    def _get_headers(self) -> Dict[str, str]:
        self.oauth.ensure_valid_token()
        return {
            "Authorization": f"Bearer {self.oauth.access_token}",
            "Content-Type": "application/json",
            "User-Agent": f"xai-oauth-client/0.1.0",
        }

    # --------------------------------------------------------------------- #
    # Image Generation
    # --------------------------------------------------------------------- #

    def generate_image(
        self,
        prompt: str,
        *,
        model: str = "grok-imagine-image",
        aspect_ratio: str = "16:9",
        resolution: str = "1k",  # Note: for images this may still be "1k"/"2k" — video uses 480p/720p/1080p
        style: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        seed: Optional[int] = None,
        return_base64: bool = False,
    ) -> Dict[str, Any]:
        """
        Generate an image using xAI's Grok Imagine.

        This method is highly customizable. You can influence the output through:
        - `style`: artistic style, lighting, mood, camera angle, etc.
        - `negative_prompt`: what to avoid
        - `resolution`: For images this may accept "1k"/"2k". For video use "480p"/"720p"/"1080p"
        - `aspect_ratio`: many options supported by xAI
        """
        if model not in IMAGE_MODELS:
            model = "grok-imagine-image"

        # Allow the model to enhance the prompt if desired
        final_prompt = self._enhance_prompt_if_requested(prompt, style)

        payload: Dict[str, Any] = {
            "model": model,
            "prompt": final_prompt,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
        }

        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if seed is not None:
            payload["seed"] = seed

        try:
            resp = self._client.post(
                f"{XAI_BASE_URL}/images/generations",
                headers=self._get_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            result = {
                "success": True,
                "model": model,
                "prompt": final_prompt,
                "aspect_ratio": aspect_ratio,
                "resolution": resolution,
            }

            if return_base64 and "data" in data:
                # Some responses may contain base64
                result["base64"] = data["data"][0].get("b64_json")
            else:
                result["url"] = data.get("data", [{}])[0].get("url")

            return result

        except Exception as e:
            return {"success": False, "error": str(e)}

    def edit_image(
        self,
        prompt: str,
        image_url: str,
        *,
        model: str = "grok-imagine-image-quality",
        aspect_ratio: str = "16:9",
        strength: float = 0.75,
    ) -> Dict[str, Any]:
        """
        Image editing / img2img using xAI.
        Note: Support depends on xAI's current API capabilities.
        """
        payload = {
            "model": model,
            "prompt": prompt,
            "image_url": image_url,
            "aspect_ratio": aspect_ratio,
            "strength": strength,
        }

        try:
            resp = self._client.post(
                f"{XAI_BASE_URL}/images/edits",
                headers=self._get_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "success": True,
                "url": data.get("data", [{}])[0].get("url"),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --------------------------------------------------------------------- #
    # Video Generation
    # --------------------------------------------------------------------- #

    def generate_video(
        self,
        prompt: str,
        *,
        duration: int = 8,
        aspect_ratio: str = "16:9",
        resolution: str = "720p",   # "480p" | "720p" | "1080p" (NOT "1k"/"2k")
        motion_strength: Optional[float] = None,
        negative_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate video using xAI's video generation endpoint.
        Highly customizable with motion and style controls.
        """
        payload: Dict[str, Any] = {
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
        }

        if motion_strength is not None:
            payload["motion_strength"] = motion_strength
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt

        try:
            resp = self._client.post(
                f"{XAI_BASE_URL}/videos/generations",
                headers=self._get_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "success": True,
                "url": data.get("video", {}).get("url"),
                "duration": duration,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --------------------------------------------------------------------- #
    # Audio (TTS) - Placeholder for future xAI audio support
    # --------------------------------------------------------------------- #

    def generate_audio(self, text: str, voice: str = "alloy") -> Dict[str, Any]:
        """
        Placeholder for audio generation.
        xAI may add TTS in the future. Currently falls back gracefully.
        """
        return {
            "success": False,
            "error": "xAI audio generation not yet available via this client.",
        }

    # --------------------------------------------------------------------- #
    # Smart Prompt Enhancement (the "model looks within itself" part)
    # --------------------------------------------------------------------- #

    def _enhance_prompt_if_requested(self, prompt: str, style: Optional[str]) -> str:
        """
        Optionally lets Grok itself improve the prompt for better results.
        This is where the 'model looks within itself' flexibility comes in.
        """
        if not style:
            return prompt

        # Simple but effective enhancement
        enhanced = f"{prompt}. Style: {style}. Highly detailed, cinematic lighting."
        return enhanced

    def close(self):
        self._client.close()