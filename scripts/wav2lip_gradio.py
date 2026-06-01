#!/usr/bin/env python3
"""
Minimal Gradio wrapper for Wav2Lip (no face crop, full image).
Assumes Wav2Lip repo + checkpoint live under toolchest/vendors/Wav2Lip.
If the checkpoint or repo is missing, the script will explain what to do.
"""
import os
import sys
import uuid
import subprocess
from pathlib import Path

import gradio as gr
from PIL import Image
from pydub import AudioSegment

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
W2L_DIR = ROOT.parent / "toolchest" / "vendors" / "Wav2Lip"
MODEL_PATH = W2L_DIR / "checkpoints" / "wav2lip_gan.pth"
INFERENCE_PY = W2L_DIR / "inference.py"

# -----------------------------------------------------------------------------
# Preprocess: save image and convert audio to mono 16 kHz WAV
# -----------------------------------------------------------------------------
def preprocess(image, audio_file):
    if image is None or audio_file is None:
        raise ValueError("Both an image and an audio file are required.")

    uid = uuid.uuid4().hex
    img_path = ROOT / f"{uid}.jpg"
    wav_path = ROOT / f"{uid}.wav"
    out_path = ROOT / f"{uid}_result.mp4"

    image.save(img_path)

    seg = AudioSegment.from_file(audio_file)
    seg = seg.set_frame_rate(16000).set_channels(1)
    seg.export(wav_path, format="wav")

    return img_path, wav_path, out_path

# -----------------------------------------------------------------------------
# Inference
# -----------------------------------------------------------------------------
def generate(image, audio):
    # Validate presence of Wav2Lip assets
    if not INFERENCE_PY.exists():
        return f"❌ Missing inference.py at {INFERENCE_PY}. Clone Wav2Lip into toolchest/vendors/Wav2Lip."
    if not MODEL_PATH.exists():
        return f"❌ Missing checkpoint at {MODEL_PATH}. Download wav2lip_gan.pth there."

    try:
        img, wav, out_vid = preprocess(image, audio)
    except Exception as e:
        return f"❌ {e}"

    env = os.environ.copy()
    # Ensure Wav2Lip is importable
    env["PYTHONPATH"] = f"{W2L_DIR}:{env.get('PYTHONPATH','')}"

    try:
        subprocess.run(
            [
                sys.executable,
                str(INFERENCE_PY),
                "--checkpoint_path",
                str(MODEL_PATH),
                "--face",
                str(img),
                "--audio",
                str(wav),
                "--outfile",
                str(out_vid),
                "--resize_factor",
                "1",
                "--pads",
                "0",
                "20",
                "0",
                "20",
                "--fps",
                "25",
                "--nosmooth",
            ],
            check=True,
            env=env,
            cwd=W2L_DIR,
        )
    except subprocess.CalledProcessError as e:
        return f"❌ Wav2Lip failed: {e}"

    return str(out_vid) if out_vid.exists() else "❌ Generation failed."

# -----------------------------------------------------------------------------
# Gradio UI
# -----------------------------------------------------------------------------
demo = gr.Interface(
    fn=generate,
    inputs=[
        gr.Image(type="pil", label="Image (Full Resolution - Face Visible)"),
        gr.Audio(type="filepath", label="Audio (any format)"),
    ],
    outputs=gr.Video(label="Talking-head MP4"),
    title="🗣️ High-Quality Wav2Lip (No Crop, Full Image)",
    description=(
        "Lip-sync using full image resolution. Add padding under the mouth and avoid smoothing "
        "for sharper lips."
    ),
    allow_flagging="never",
    live=True,
)

if __name__ == "__main__":
    demo.launch()
