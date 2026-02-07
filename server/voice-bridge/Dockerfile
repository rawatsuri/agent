# Voice Bridge - Python Service Dockerfile
# Self-hosted Vocode telephony server

FROM python:3.11-slim-bookworm as base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PIP_DEFAULT_TIMEOUT=100

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    libasound2 \
    portaudio19-dev \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# Production stage
FROM base as production

# Copy application code
COPY . .

# Create non-root user
RUN groupadd -r voicebridge && useradd -r -g voicebridge voicebridge && \
    chown -R voicebridge:voicebridge /app

# Switch to non-root user
USER voicebridge

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start command
CMD ["python", "app.py"]

# Development stage
FROM base as development

# Install development dependencies
RUN pip install watchdog

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Start with hot reload
CMD ["python", "app.py"]
