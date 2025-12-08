# Multi-stage build for transcription service
# Supports both CPU and CUDA

ARG DEVICE=cpu

# ============================================
# Base stage with common dependencies
# ============================================
FROM python:3.11-slim-bookworm AS base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# ============================================
# CPU build stage
# ============================================
FROM base AS cpu-build

# Install Python dependencies for CPU
COPY pyproject.toml .
RUN pip install --no-cache-dir . && \
    pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# ============================================
# CUDA build stage
# ============================================
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04 AS cuda-build

# Install Python and system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3-pip \
    python3.11-venv \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.11 as default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install Python dependencies for CUDA
COPY pyproject.toml .
RUN pip install --no-cache-dir ".[cuda]" && \
    pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# ============================================
# Final stage (select based on DEVICE arg)
# ============================================
FROM ${DEVICE}-build AS final

WORKDIR /app

# Copy application code
COPY transcription_service/ ./transcription_service/

# Create cache directory for models
RUN mkdir -p /cache && chmod 777 /cache

# Create non-root user
RUN useradd -m -u 1000 transcription && \
    chown -R transcription:transcription /app /cache

USER transcription

# Expose port
EXPOSE 3004

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:3004/ping')" || exit 1

# Run the service
CMD ["python", "-m", "uvicorn", "transcription_service.main:app", "--host", "0.0.0.0", "--port", "3004"]
