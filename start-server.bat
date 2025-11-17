@echo off
REM Quick start script for signaling server (Windows)

echo 🚀 Starting IndexerChain Signaling Server...
echo.

REM Check if node is available
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if ws package exists
if not exist "node_modules\ws" (
    echo 📦 Installing ws package...
    call npm install ws
)

REM Start the server
echo ✅ Starting server on ws://localhost:8080
echo    Press Ctrl+C to stop the server
echo.
node signaling-server-example.js

pause

