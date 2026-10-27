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


@lru_cache
def settings() -> Settings:
    return Settings()
