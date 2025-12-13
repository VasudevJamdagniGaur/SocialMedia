@echo off
REM Deite CORS Proxy Server Startup Script for Windows
REM This script starts the CORS proxy server to bypass browser CORS restrictions

echo 🚀 Starting Deite CORS Proxy Server...
echo 📋 Prerequisites check:

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js v14 or higher.
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm.
    pause
    exit /b 1
)

echo ✅ All prerequisites met!
echo.

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    npm install
)

echo 🔥 Starting CORS proxy server...
echo 🌐 Server will be available at: http://localhost:3001
echo 💬 Chat API: http://localhost:3001/api/chat
echo 🧠 Emotional Analysis API: http://localhost:3001/api/emotional-analysis
echo 🔍 Pattern Analysis API: http://localhost:3001/api/pattern-analysis
echo 🔗 Proxying to RunPod: https://uyuwcw4zaa1mzb-11434.proxy.runpod.net/
echo.

REM Start the server
node cors-proxy-server.js

pause
