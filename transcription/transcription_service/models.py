from pydantic import BaseModel
from typing import Optional


class WordTimestamp(BaseModel):
    """Individual word with timing information."""
    word: str
    start: float  # seconds
    end: float  # seconds
    confidence: float


class TranscriptionSegment(BaseModel):
    """A segment of transcribed speech."""
    speaker: Optional[str] = None  # "SPEAKER_0", "SPEAKER_1", etc.
    start: float  # seconds
    end: float  # seconds
    text: str
    words: Optional[list[WordTimestamp]] = None


class TranscriptionRequest(BaseModel):
    """Request to transcribe a video/audio file."""
    audio_path: str  # Path to audio/video file (container-accessible)
    language: Optional[str] = None  # Auto-detect if None
    diarization: bool = True
    word_timestamps: bool = True


class TranscriptionResponse(BaseModel):
    """Complete transcription result."""
    language: str  # Detected language code (e.g., "en", "es")
    language_probability: float  # Confidence 0-1
    duration: float  # Total audio duration in seconds
    segments: list[TranscriptionSegment]


class ModelInfo(BaseModel):
    """Information about available models."""
    name: str
    size: str
    description: str


class ModelsResponse(BaseModel):
    """List of available Whisper models."""
    current_model: str
    available_models: list[ModelInfo]


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    model_loaded: bool
    device: str
    diarization_enabled: bool


class ErrorResponse(BaseModel):
    """Error response."""
    error: str
    detail: Optional[str] = None
