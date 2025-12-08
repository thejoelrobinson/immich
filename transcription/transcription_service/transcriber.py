"""Core transcription logic using faster-whisper."""

import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from .config import Settings, get_settings
from .models import TranscriptionRequest, TranscriptionResponse, TranscriptionSegment, WordTimestamp
from .diarizer import SpeakerDiarizer

logger = logging.getLogger(__name__)


class Transcriber:
    """Video/audio transcription using faster-whisper with optional speaker diarization."""

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._model = None
        self._diarizer = None

    def _load_model(self):
        """Lazy load the Whisper model."""
        if self._model is not None:
            return

        from faster_whisper import WhisperModel

        logger.info(f"Loading Whisper model '{self.settings.whisper_model}' on {self.settings.device}...")

        self._model = WhisperModel(
            self.settings.whisper_model,
            device=self.settings.device,
            compute_type=self.settings.compute_type,
            download_root=self.settings.model_cache_dir,
        )

        logger.info("Whisper model loaded successfully")

    def _get_diarizer(self) -> SpeakerDiarizer:
        """Get or create the speaker diarizer."""
        if self._diarizer is None:
            self._diarizer = SpeakerDiarizer(
                cache_dir=self.settings.model_cache_dir,
                device=self.settings.device,
            )
        return self._diarizer

    @property
    def model_loaded(self) -> bool:
        """Check if the model is loaded."""
        return self._model is not None

    def _extract_audio(self, video_path: str) -> str:
        """Extract audio from video file to a temporary WAV file."""
        # Create temp file for audio
        temp_dir = tempfile.mkdtemp()
        audio_path = os.path.join(temp_dir, "audio.wav")

        try:
            # Use ffmpeg to extract audio
            cmd = [
                "ffmpeg",
                "-i", video_path,
                "-vn",  # No video
                "-acodec", "pcm_s16le",  # PCM 16-bit
                "-ar", "16000",  # 16kHz sample rate
                "-ac", "1",  # Mono
                "-y",  # Overwrite
                audio_path,
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout
            )

            if result.returncode != 0:
                raise RuntimeError(f"FFmpeg failed: {result.stderr}")

            return audio_path

        except Exception as e:
            # Clean up on failure
            if os.path.exists(audio_path):
                os.unlink(audio_path)
            if os.path.exists(temp_dir):
                os.rmdir(temp_dir)
            raise e

    def _get_audio_duration(self, audio_path: str) -> float:
        """Get the duration of an audio file using ffprobe."""
        try:
            cmd = [
                "ffprobe",
                "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                audio_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            return float(result.stdout.strip())
        except Exception:
            return 0.0

    async def transcribe(self, request: TranscriptionRequest) -> TranscriptionResponse:
        """
        Transcribe a video/audio file.

        Args:
            request: Transcription request with file path and options

        Returns:
            Complete transcription with segments, timestamps, and optional speaker labels
        """
        self._load_model()

        audio_path = request.audio_path
        temp_audio = None

        try:
            # Check if we need to extract audio from video
            file_ext = Path(request.audio_path).suffix.lower()
            video_extensions = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".wmv", ".flv", ".m4v"}

            if file_ext in video_extensions:
                logger.info(f"Extracting audio from video: {request.audio_path}")
                temp_audio = self._extract_audio(request.audio_path)
                audio_path = temp_audio

            # Get audio duration
            duration = self._get_audio_duration(audio_path)

            # Transcribe with faster-whisper
            logger.info(f"Starting transcription of {audio_path}")

            segments_generator, info = self._model.transcribe(
                audio_path,
                language=request.language,
                word_timestamps=request.word_timestamps,
                vad_filter=True,  # Filter out non-speech
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    speech_pad_ms=200,
                ),
            )

            # Convert generator to list and build response
            segments = []
            for seg in segments_generator:
                words = None
                if request.word_timestamps and seg.words:
                    words = [
                        WordTimestamp(
                            word=w.word.strip(),
                            start=w.start,
                            end=w.end,
                            confidence=w.probability,
                        )
                        for w in seg.words
                    ]

                segments.append({
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text.strip(),
                    "words": words,
                    "speaker": None,
                })

            logger.info(f"Transcription complete: {len(segments)} segments, language={info.language}")

            # Perform speaker diarization if enabled
            if request.diarization and self.settings.diarization_enabled and len(segments) > 0:
                logger.info("Starting speaker diarization...")
                try:
                    diarizer = self._get_diarizer()
                    segments = diarizer.diarize(audio_path, segments)
                    logger.info("Speaker diarization complete")
                except Exception as e:
                    logger.warning(f"Speaker diarization failed, continuing without: {e}")

            # Build response
            response_segments = [
                TranscriptionSegment(
                    speaker=seg.get("speaker"),
                    start=seg["start"],
                    end=seg["end"],
                    text=seg["text"],
                    words=seg.get("words"),
                )
                for seg in segments
            ]

            return TranscriptionResponse(
                language=info.language,
                language_probability=info.language_probability,
                duration=duration or (segments[-1]["end"] if segments else 0.0),
                segments=response_segments,
            )

        finally:
            # Clean up temporary audio file
            if temp_audio and os.path.exists(temp_audio):
                os.unlink(temp_audio)
                temp_dir = os.path.dirname(temp_audio)
                if os.path.exists(temp_dir):
                    os.rmdir(temp_dir)


# Global transcriber instance
_transcriber: Optional[Transcriber] = None


def get_transcriber() -> Transcriber:
    """Get or create the global transcriber instance."""
    global _transcriber
    if _transcriber is None:
        _transcriber = Transcriber()
    return _transcriber
