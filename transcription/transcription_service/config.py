from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Whisper model configuration
    whisper_model: str = "small"
    device: str = "cpu"  # "cpu" or "cuda"
    compute_type: str = "int8"  # "int8", "float16", "float32"

    # Diarization settings
    diarization_enabled: bool = True

    # Model cache directory
    model_cache_dir: str = "/cache"

    # Server settings
    host: str = "0.0.0.0"
    port: int = 3004

    # Processing settings
    max_chunk_duration: int = 1800  # 30 minutes in seconds

    class Config:
        env_prefix = ""
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
