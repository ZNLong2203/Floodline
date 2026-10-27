"""Voice notes: residents record what they can't type with wet hands in the dark."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from floodline.meta.client import Media, ModelClient


def to_wav(data: bytes) -> bytes:
    """Any audio the browser or a phone records -> mono 16-bit PCM WAV at 24 kHz."""
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "in", Path(tmp) / "out.wav"
        src.write_bytes(data)
        subprocess.run(
            [
                "ffmpeg",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(src),
                "-ac",
                "1",
                "-ar",
                "24000",
                "-c:a",
                "pcm_s16le",
                "-map_metadata",
                "-1",
                str(dst),
            ],
            check=True,
        )
        return dst.read_bytes()


def transcribe_upload(client: ModelClient, data: bytes) -> str:
    result = client.transcribe(Media(to_wav(data), "audio/wav"), ["Vietnamese"])
    return result.get("transcript", "").strip()
