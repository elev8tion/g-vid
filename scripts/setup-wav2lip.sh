#!/usr/bin/env bash
set -euo pipefail

# Helper script to set up Wav2Lip locally.
# It will NOT run automatically; review and run manually.
#
# Requirements:
#   - git, python3, pip
#   - ffmpeg available in PATH (you already have /opt/homebrew/bin/ffmpeg)
#   - ~400MB disk for weights
#
# Usage:
#   chmod +x scripts/setup-wav2lip.sh
#   ./scripts/setup-wav2lip.sh
#
# After running, set env vars before starting the backend:
#   export WAV2LIP_ENABLED=1
#   export WAV2LIP_CLI=python3
#   export WAV2LIP_SCRIPT="$(pwd)/toolchest/vendors/Wav2Lip/inference.py"
#   export WAV2LIP_CHECKPOINT="$(pwd)/toolchest/vendors/Wav2Lip/checkpoints/wav2lip_gan.pth"
#   # optional: export WAV2LIP_DEVICE=mps   # or cpu/cuda
#
# Notes for Apple Silicon:
#   - You can try MPS: export WAV2LIP_DEVICE=mps
#   - If torch install via pip fails for MPS wheels, install a CPU wheel or follow PyTorch MPS install docs.
#
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/toolchest/vendors"
W2L_DIR="$VENDOR_DIR/Wav2Lip"
CKPT_DIR="$W2L_DIR/checkpoints"
CKPT_PATH="$CKPT_DIR/wav2lip_gan.pth"

mkdir -p "$CKPT_DIR"

if [ ! -d "$W2L_DIR/.git" ]; then
  echo "Cloning Wav2Lip into $W2L_DIR ..."
  git clone https://github.com/Rudrabha/Wav2Lip.git "$W2L_DIR"
else
  echo "Wav2Lip repo already present at $W2L_DIR"
fi

echo "Installing Python deps (this may take time)..."
cd "$W2L_DIR"
# Basic deps; adjust torch install as needed for your platform.
pip install -r requirements.txt || true
# If torch is missing/old, uncomment and adjust for your platform (CPU example):
# pip install torch torchvision torchaudio --extra-index-url https://download.pytorch.org/whl/cpu

if [ ! -f "$CKPT_PATH" ]; then
  echo "Downloading wav2lip_gan.pth ..."
  mkdir -p "$CKPT_DIR"
  curl -L "https://github.com/Rudrabha/Wav2Lip/releases/download/v0.1/wav2lip_gan.pth" -o "$CKPT_PATH"
else
  echo "Checkpoint already present at $CKPT_PATH"
fi

echo "\nDone. Set the env vars before starting the backend, e.g.:"
echo "  export WAV2LIP_ENABLED=1"
echo "  export WAV2LIP_CLI=python3"
echo "  export WAV2LIP_SCRIPT=\"$W2L_DIR/inference.py\""
echo "  export WAV2LIP_CHECKPOINT=\"$CKPT_PATH\""
echo "  # optional: export WAV2LIP_DEVICE=mps   # or cpu/cuda"
