@echo off
REM Voice Bridge Startup Script for Windows
REM Usage: start.bat [dev|prod|docker]

echo 🚀 Voice Bridge Startup
echo ======================

REM Default environment
set ENV=%1
if "%ENV%"=="" set ENV=dev

echo Environment: %ENV%
echo.

REM Check if .env exists
if not exist .env (
    echo ⚠️  .env file not found, copying from .env.example
    copy .env.example .env
    echo ⚠️  Please edit .env with your configuration before running!
    pause
    exit /b 1
)

REM Check Python version
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python not found. Please install Python 3.11+
    pause
    exit /b 1
)

for /f "tokens=2" %%a in ('python --version') do set PYTHON_VERSION=%%a
echo ✅ Python version: %PYTHON_VERSION%

REM Check if running in Docker
if "%ENV%"=="docker" goto :docker
if "%ENV%"=="container" goto :docker

REM Check virtual environment
if not exist venv (
    echo 📦 Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo ✅ Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/update dependencies
echo 📦 Installing dependencies...
pip install --upgrade pip
pip install -r requirements.txt

REM Start based on environment
if "%ENV%"=="prod" goto :production
if "%ENV%"=="production" goto :production

:development
echo 🔧 Starting in DEVELOPMENT mode...
set ENVIRONMENT=development
uvicorn app:app --host 0.0.0.0 --port 8000 --reload --log-level debug
goto :end

:production
echo 🏭 Starting in PRODUCTION mode...
set ENVIRONMENT=production
gunicorn app:app --workers 2 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120
goto :end

:docker
echo 🐳 Starting in Docker container...
docker build -t voice-bridge .
docker run -d --name voice-bridge -p 8000:8000 --env-file .env --restart unless-stopped voice-bridge
echo ✅ Voice Bridge started in Docker
echo Health check: http://localhost:8000/health
goto :end

:end
pause
