# Voice Bridge Dockerfile - Python 3.11 with Vocode
# Exotel + Vocode streaming integration
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for Vocode + audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build tools
    build-essential \
    libffi-dev \
    # Audio libraries required by Vocode/sounddevice
    libsndfile1 \
    libportaudio2 \
    portaudio19-dev \
    libasound2 \
    libasound2-dev \
    # FFmpeg for audio processing
    ffmpeg \
    # HTTP client
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set dummy audio driver for headless server
ENV SDL_AUDIODRIVER=dummy
ENV PULSE_SERVER=''

# Upgrade pip
RUN pip install --upgrade pip setuptools wheel

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download NLTK data
RUN python -c "import nltk; nltk.download('punkt', quiet=True)" || true

# Copy application
COPY . .

# Expose port
EXPOSE 10000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:10000/health || exit 1

# Use PORT env var from Render
ENV PORT=10000

# Run with gunicorn
CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT} --workers 1 --worker-class uvicorn.workers.UvicornWorker --timeout 120"]
