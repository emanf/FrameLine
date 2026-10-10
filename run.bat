@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo Error: npm was not found. Install Node.js and try again.
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Installing application dependencies...
    call npm install
    if errorlevel 1 exit /b 1
)

if not exist "node_modules\ffmpeg-static\ffmpeg.exe" (
    echo Installing application dependencies...
    call npm install
    if errorlevel 1 exit /b 1
)

if not exist "node_modules\ffprobe-static\bin\win32\x64\ffprobe.exe" (
    echo Installing application dependencies...
    call npm install
    if errorlevel 1 exit /b 1
)

node -e "require('sharp')" >nul 2>nul
if errorlevel 1 (
    echo Installing image-import dependency...
    call npm install
    if errorlevel 1 exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
    echo Error: Python was not found. Install Python 3.10 or newer and try again.
    exit /b 1
)

python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 (
    echo Error: Python 3.10 or newer is required.
    exit /b 1
)

python -c "import PIL, sys; version = tuple(map(int, PIL.__version__.split('.')[:2])); sys.exit(0 if (10, 4) <= version < (12, 0) else 1)" >nul 2>nul
if errorlevel 1 (
    echo Installing Python image-processing dependency...
    python -m pip install -r requirements.txt
    if errorlevel 1 exit /b 1
)

call npm start
exit /b %errorlevel%
