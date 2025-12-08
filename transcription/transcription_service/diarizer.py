"""Speaker diarization using speechbrain."""

import logging
from typing import Optional
from pathlib import Path

import torch
import torchaudio

logger = logging.getLogger(__name__)


class SpeakerDiarizer:
    """Speaker diarization using speechbrain's pre-trained models."""

    def __init__(self, cache_dir: str = "/cache", device: str = "cpu"):
        self.cache_dir = cache_dir
        self.device = device
        self._model = None
        self._embedding_model = None

    def _load_models(self):
        """Lazy load the diarization models."""
        if self._model is not None:
            return

        try:
            from speechbrain.inference.speaker import SpeakerRecognition
            from speechbrain.inference.VAD import VAD

            logger.info("Loading speaker diarization models...")

            # Load VAD model for voice activity detection
            self._vad = VAD.from_hparams(
                source="speechbrain/vad-crdnn-libriparty",
                savedir=f"{self.cache_dir}/vad",
                run_opts={"device": self.device},
            )

            # Load speaker embedding model
            self._embedding_model = SpeakerRecognition.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir=f"{self.cache_dir}/spkrec",
                run_opts={"device": self.device},
            )

            self._model = True
            logger.info("Speaker diarization models loaded successfully")

        except Exception as e:
            logger.error(f"Failed to load diarization models: {e}")
            raise

    def diarize(
        self,
        audio_path: str,
        segments: list[dict],
        num_speakers: Optional[int] = None,
    ) -> list[dict]:
        """
        Perform speaker diarization on transcription segments.

        Args:
            audio_path: Path to the audio file
            segments: List of transcription segments with start/end times
            num_speakers: Optional number of speakers (auto-detect if None)

        Returns:
            Segments with speaker labels added
        """
        self._load_models()

        try:
            # Load audio
            waveform, sample_rate = torchaudio.load(audio_path)

            # Resample if needed (speechbrain expects 16kHz)
            if sample_rate != 16000:
                resampler = torchaudio.transforms.Resample(sample_rate, 16000)
                waveform = resampler(waveform)
                sample_rate = 16000

            # Convert to mono if stereo
            if waveform.shape[0] > 1:
                waveform = torch.mean(waveform, dim=0, keepdim=True)

            # Extract embeddings for each segment
            embeddings = []
            valid_segments = []

            for i, seg in enumerate(segments):
                start_sample = int(seg["start"] * sample_rate)
                end_sample = int(seg["end"] * sample_rate)

                # Skip very short segments
                if end_sample - start_sample < sample_rate * 0.5:  # < 0.5 seconds
                    embeddings.append(None)
                    continue

                segment_audio = waveform[:, start_sample:end_sample]

                # Get speaker embedding
                try:
                    embedding = self._embedding_model.encode_batch(segment_audio)
                    embeddings.append(embedding.squeeze().cpu().numpy())
                    valid_segments.append(i)
                except Exception as e:
                    logger.warning(f"Failed to extract embedding for segment {i}: {e}")
                    embeddings.append(None)

            # Cluster embeddings to identify speakers
            speaker_labels = self._cluster_embeddings(
                [e for e in embeddings if e is not None],
                num_speakers=num_speakers,
            )

            # Assign speaker labels to segments
            label_idx = 0
            for i, seg in enumerate(segments):
                if embeddings[i] is not None:
                    seg["speaker"] = f"SPEAKER_{speaker_labels[label_idx]}"
                    label_idx += 1
                else:
                    # Assign based on surrounding segments or default
                    seg["speaker"] = self._infer_speaker(segments, i)

            return segments

        except Exception as e:
            logger.error(f"Diarization failed: {e}")
            # Return segments without speaker labels
            for seg in segments:
                seg["speaker"] = None
            return segments

    def _cluster_embeddings(
        self,
        embeddings: list,
        num_speakers: Optional[int] = None,
    ) -> list[int]:
        """Cluster speaker embeddings using agglomerative clustering."""
        import numpy as np
        from sklearn.cluster import AgglomerativeClustering

        if len(embeddings) == 0:
            return []

        if len(embeddings) == 1:
            return [0]

        embeddings_array = np.array(embeddings)

        # Estimate number of speakers if not provided
        if num_speakers is None:
            # Use silhouette score to find optimal number of clusters
            from sklearn.metrics import silhouette_score

            best_score = -1
            best_n = 2

            for n in range(2, min(10, len(embeddings))):
                clustering = AgglomerativeClustering(
                    n_clusters=n,
                    metric="cosine",
                    linkage="average",
                )
                labels = clustering.fit_predict(embeddings_array)

                if len(set(labels)) > 1:
                    score = silhouette_score(embeddings_array, labels, metric="cosine")
                    if score > best_score:
                        best_score = score
                        best_n = n

            num_speakers = best_n

        # Perform final clustering
        clustering = AgglomerativeClustering(
            n_clusters=num_speakers,
            metric="cosine",
            linkage="average",
        )
        labels = clustering.fit_predict(embeddings_array)

        return labels.tolist()

    def _infer_speaker(self, segments: list[dict], index: int) -> Optional[str]:
        """Infer speaker for a segment based on surrounding segments."""
        # Look at previous segment
        if index > 0 and segments[index - 1].get("speaker"):
            return segments[index - 1]["speaker"]

        # Look at next segment
        if index < len(segments) - 1 and segments[index + 1].get("speaker"):
            return segments[index + 1]["speaker"]

        return "SPEAKER_0"
