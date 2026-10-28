"""Runtime settings, read from the environment and `.env`."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def _env(*names: str) -> AliasChoices:
    return AliasChoices(*names)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    model_api_key: str = Field("", validation_alias=_env("MODEL_API_KEY"))
    model_base_url: str = Field("https://api.meta.ai/v1", validation_alias=_env("MODEL_BASE_URL"))

    spark_model: str = Field("muse-spark-1.3", validation_alias=_env("FLOODLINE_SPARK_MODEL"))
    sam_model: str = Field("sam-3.1", validation_alias=_env("FLOODLINE_SAM_MODEL"))
    voice_model: str = Field(
        "muse-voice-transcribe-1.0", validation_alias=_env("FLOODLINE_VOICE_MODEL")
    )

    # live: call the API. record: call it and save every answer as a cassette.
    # replay: answer only from cassettes, so the demo and tests run without a key.
    model_mode: Literal["live", "record", "replay", "migrate"] = Field(
        "live", validation_alias=_env("FLOODLINE_MODEL_MODE")
    )
    cassette_dir: Path = Field(DATA / "cassettes", validation_alias=_env("FLOODLINE_CASSETTES"))
    state_dir: Path = Field(ROOT / "var", validation_alias=_env("FLOODLINE_STATE_DIR"))
    # Public demo: Replay re-plays the stored night instead of re-analysing it, and Clear is off,
    # so one visitor can't empty the map for the next.
    demo_lock: bool = Field(False, validation_alias=_env("FLOODLINE_DEMO_LOCK"))

    # WhatsApp intake (Cloud API). The channel analyses live, recording its answers, even when the
    # web demo replays, so the server needs MODEL_API_KEY for it.
    whatsapp_token: str = Field("", validation_alias=_env("WHATSAPP_TOKEN"))
    whatsapp_app_secret: str = Field("", validation_alias=_env("WHATSAPP_APP_SECRET"))
    whatsapp_phone_number_id: str = Field("", validation_alias=_env("WHATSAPP_PHONE_NUMBER_ID"))
    whatsapp_verify_token: str = Field("", validation_alias=_env("WHATSAPP_VERIFY_TOKEN"))
    whatsapp_graph_version: str = Field("v23.0", validation_alias=_env("WHATSAPP_GRAPH_VERSION"))
    whatsapp_allowed: str = Field("", validation_alias=_env("WHATSAPP_ALLOWED"))  # comma-separated
    whatsapp_hourly_limit: int = Field(30, validation_alias=_env("WHATSAPP_HOURLY_LIMIT"))
    whatsapp_model_mode: Literal["live", "record", "replay"] = Field(
        "record", validation_alias=_env("WHATSAPP_MODEL_MODE")
    )

    # Telegram intake: a public bot anyone can try, analysing live within hourly and daily caps.
    telegram_bot_token: str = Field("", validation_alias=_env("TELEGRAM_BOT_TOKEN"))
    telegram_webhook_secret: str = Field("", validation_alias=_env("TELEGRAM_WEBHOOK_SECRET"))
    telegram_allowed: str = Field(
        "", validation_alias=_env("TELEGRAM_ALLOWED")
    )  # chat ids; empty = all
    telegram_hourly_limit: int = Field(20, validation_alias=_env("TELEGRAM_HOURLY_LIMIT"))
    telegram_daily_limit: int = Field(150, validation_alias=_env("TELEGRAM_DAILY_LIMIT"))
    telegram_model_mode: Literal["live", "record", "replay"] = Field(
        "live", validation_alias=_env("TELEGRAM_MODEL_MODE")
    )


@lru_cache
def settings() -> Settings:
    return Settings()
