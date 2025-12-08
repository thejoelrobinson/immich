"""FastAPI application for video transcription service."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .models import (
    ErrorResponse,
    HealthResponse,
    ModelInfo,
    ModelsResponse,
    TranscriptionRequest,
    TranscriptionResponse,
)
from .transcriber import get_transcriber

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    settings = get_settings()
    logger.info(f"Starting transcription service on {settings.host}:{settings.port}")
    logger.info(f"Model: {settings.whisper_model}, Device: {settings.device}")
    logger.info(f"Diarization: {'enabled' if settings.diarization_enabled else 'disabled'}")

    # Pre-load model on startup (optional - can also lazy load)
    # transcriber = get_transcriber()
    # transcriber._load_model()

    yield

    logger.info("Shutting down transcription service")


app = FastAPI(
    title="Immich Transcription Service",
    description="Video transcription with speaker diarization using faster-whisper",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ping", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    settings = get_settings()
    transcriber = get_transcriber()

    return HealthResponse(
        status="ok",
        model_loaded=transcriber.model_loaded,
        device=settings.device,
        diarization_enabled=settings.diarization_enabled,
    )


@app.get("/models", response_model=ModelsResponse)
async def list_models():
    """List available Whisper models."""
    settings = get_settings()

    available_models = [
        ModelInfo(
            name="tiny",
            size="39M parameters",
            description="Fastest, lowest accuracy. Good for testing.",
        ),
        ModelInfo(
            name="base",
            size="74M parameters",
            description="Fast with basic accuracy.",
        ),
        ModelInfo(
            name="small",
            size="244M parameters",
            description="Good balance of speed and accuracy. Recommended for most uses.",
        ),
        ModelInfo(
            name="medium",
            size="769M parameters",
            description="Higher accuracy, slower. Better for non-English.",
        ),
        ModelInfo(
            name="large-v3",
            size="1.5B parameters",
            description="Best accuracy, slowest. Requires significant GPU memory.",
        ),
    ]

    return ModelsResponse(
        current_model=settings.whisper_model,
        available_models=available_models,
    )


@app.post(
    "/transcribe",
    response_model=TranscriptionResponse,
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def transcribe(request: TranscriptionRequest):
    """
    Transcribe a video or audio file.

    The file must be accessible from the container (mounted volume).

    Returns transcription segments with:
    - Start/end timestamps
    - Text content
    - Optional word-level timestamps
    - Optional speaker labels (if diarization enabled)
    """
    import os

    # Validate file exists
    if not os.path.exists(request.audio_path):
        raise HTTPException(
            status_code=400,
            detail=f"File not found: {request.audio_path}",
        )

    try:
        transcriber = get_transcriber()
        result = await transcriber.transcribe(request)
        return result

    except Exception as e:
        logger.exception(f"Transcription failed for {request.audio_path}")
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "transcription_service.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )
