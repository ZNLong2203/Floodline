"""One client for every Meta Model API call Floodline makes.

Each call can be recorded to a cassette and replayed, so the eval harness, the
tests and the public demo run without an API key and give the same answer twice.
A cassette is keyed by the request with every media payload replaced by its hash.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from openai import OpenAI

from floodline.config import Settings, settings


class CassetteMissingError(RuntimeError):
    """Replay mode asked for a call that was never recorded."""


@dataclass(frozen=True)
class Media:
    """Bytes plus a MIME type, as sent to the API."""

    data: bytes
    mime: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()

    def data_url(self) -> str:
        return f"data:{self.mime};base64,{base64.b64encode(self.data).decode()}"


@dataclass
class CallStats:
    calls: int = 0
    replayed: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    sam_images: int = 0
    seconds: float = 0.0


def _strip_media(value: Any) -> Any:
    """Replace inline base64 media with its hash so the cassette key is stable and small."""
    if isinstance(value, dict):
        return {k: _strip_media(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_strip_media(v) for v in value]
    if isinstance(value, str) and value.startswith("data:") and ";base64," in value:
        head, _, payload = value.partition(";base64,")
        return f"{head};sha256,{hashlib.sha256(base64.b64decode(payload)).hexdigest()}"
    return value


class ModelClient:
    def __init__(self, cfg: Settings | None = None) -> None:
        self.cfg = cfg or settings()
        self.stats = CallStats()
        self._openai: OpenAI | None = None

    # -- plumbing -----------------------------------------------------------------

    @property
    def openai(self) -> OpenAI:
        if self._openai is None:
            if not self.cfg.model_api_key:
                raise RuntimeError(
                    "MODEL_API_KEY is not set. Add it to .env, or run with "
                    "FLOODLINE_MODEL_MODE=replay to use recorded answers."
                )
            self._openai = OpenAI(
                base_url=self.cfg.model_base_url,
                api_key=self.cfg.model_api_key,
                max_retries=4,
                timeout=120,
            )
        return self._openai

    def _cassette_path(self, kind: str, request: dict[str, Any]) -> tuple[Path, str]:
        canonical = json.dumps(_strip_media(request), sort_keys=True, ensure_ascii=False)
        key = hashlib.sha256(f"{kind}\n{canonical}".encode()).hexdigest()[:32]
        return self.cfg.cassette_dir / kind / f"{key}.json", canonical

    def _cached(self, kind: str, request: dict[str, Any], call) -> Any:
        path, canonical = self._cassette_path(kind, request)
        mode = self.cfg.model_mode
        if mode in ("replay", "record") and path.exists():
            self.stats.replayed += 1
            return json.loads(path.read_text())["response"]
        if mode == "replay":
            raise CassetteMissingError(f"no recorded {kind} answer at {path.name}")
        started = time.monotonic()
        response = call()
        self.stats.calls += 1
        self.stats.seconds += time.monotonic() - started
        if mode == "record":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(
                    {"request": json.loads(canonical), "response": response},
                    ensure_ascii=False,
                    indent=1,
                )
            )
        return response

    # -- Muse Spark: structured vision and text -------------------------------------

    def spark_json(
        self,
        *,
        system: str,
        text: str,
        images: list[Media] | None = None,
        schema_name: str,
        schema: dict[str, Any],
        effort: str = "low",
        model: str | None = None,
    ) -> dict[str, Any]:
        """One Muse Spark call whose answer is constrained to `schema`."""
        content: list[dict[str, Any]] = [
            {"type": "image_url", "image_url": {"url": m.data_url()}} for m in images or []
        ]
        content.append({"type": "text", "text": text})
        request = {
            "model": model or self.cfg.spark_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema, "strict": True},
            },
            "reasoning_effort": effort,
        }

        def call() -> dict[str, Any]:
            r = self.openai.chat.completions.create(**request)
            if r.usage:
                self.stats.input_tokens += r.usage.prompt_tokens
                self.stats.output_tokens += r.usage.completion_tokens
            return {"content": r.choices[0].message.content, "model": r.model}

        response = self._cached("spark", request, call)
        return json.loads(response["content"])

    # -- SAM 3.1: segmentation ------------------------------------------------------

    def sam(
        self,
        *,
        prompt: str,
        image: Media | None = None,
        video_file_id: str | None = None,
        propagation: str | None = None,
    ) -> str:
        """Run SAM 3.1 and return its raw output text (one line per frame)."""
        if (image is None) == (video_file_id is None):
            raise ValueError("pass exactly one of image or video_file_id")
        media: dict[str, Any] = (
            {"type": "input_image", "image_url": image.data_url()}
            if image is not None
            else {"type": "input_video", "file_id": video_file_id}
        )
        metadata = {"mask_encoding": "one_bit", "include_confidence": "true"}
        if propagation:
            metadata["propagation_direction"] = propagation
        request = {
            "model": self.cfg.sam_model,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": prompt}, media],
                }
            ],
            "metadata": metadata,
        }

        def call() -> dict[str, Any]:
            parts: list[str] = []
            with self.openai.responses.stream(**request) as stream:
                for event in stream:
                    if event.type == "response.output_text.delta":
                        parts.append(event.delta)
            self.stats.sam_images += 1
            return {"text": "\n".join(p.strip() for p in parts if p.strip())}

        return self._cached("sam", request, call)["text"]

    def upload(self, path: Path) -> str:
        """Upload a file once (for video) and return its file id."""
        with path.open("rb") as f:
            return self.openai.files.create(purpose="user_data", file=f).id

    # -- Muse Voice Transcribe --------------------------------------------------------

    def transcribe(self, wav: Media, languages: list[str] | None = None) -> dict[str, Any]:
        """Transcribe a mono 16-bit WAV. Vietnamese is biased for by default."""
        settings_part = {
            "mode": "ENDPOINTING",
            "model": self.cfg.voice_model,
            "audioEncoding": "WAV",
            "languageBias": languages or ["Vietnamese"],
        }
        request = {"request": settings_part, "audio": f"data:{wav.mime};base64,"
                   + base64.b64encode(wav.data).decode()}

        def call() -> dict[str, Any]:
            url = self.cfg.model_base_url.rstrip("/") + "/asr/transcribe"
            r = httpx.post(
                url,
                params={"sessionId": f"floodline-{wav.sha256[:12]}"},
                headers={"Authorization": f"Bearer {self.cfg.model_api_key}"},
                files={
                    "request": (None, json.dumps(settings_part), "application/json"),
                    "audio": ("audio.wav", wav.data, "audio/wav"),
                },
                timeout=120,
            )
            r.raise_for_status()
            return r.json()

        return self._cached("voice", request, call)
