"""
Advanced Media Generation Example using xAI OAuth

This demonstrates the flexible and customizable media capabilities.
"""

from xai_oauth import XaiOAuthClient, XaiMediaClient

def main():
    # Authenticate
    oauth = XaiOAuthClient()
    if not oauth.is_authenticated:
        print("Please login first: xai-oauth login")
        return

    media = XaiMediaClient(oauth)

    print("=== Image Generation (Highly Customizable) ===")
    result = media.generate_image(
        prompt="A cyberpunk samurai standing on a rainy neon street at night",
        model="grok-imagine-image-quality",
        aspect_ratio="16:9",
        resolution="2k",
        style="cinematic, volumetric lighting, highly detailed, Blade Runner aesthetic",
        negative_prompt="blurry, low quality, text, watermark",
    )
    print(result)

    print("\n=== Video Generation ===")
    video = media.generate_video(
        prompt="A serene mountain lake at sunrise with mist rising from the water",
        duration=8,
        aspect_ratio="16:9",
        motion_strength=0.6,
    )
    print(video)

    media.close()


if __name__ == "__main__":
    main()