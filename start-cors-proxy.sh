#!/bin/bash

# Deite CORS Proxy Server Startup Script
# This script starts the CORS proxy server to bypass browser CORS restrictions

echo "🚀 Starting Deite CORS Proxy Server..."
echo "📋 Prerequisites check:"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v14 or higher."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm."
    exit 1
fi

echo "✅ All prerequisites met!"
echo ""

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo "🔥 Starting CORS proxy server..."
echo "🌐 Backend base URL: https://detea-backend.onrender.com"
echo "💬 Chat API: https://detea-backend.onrender.com/chat"
echo "🧠 Emotional Analysis API: https://detea-backend.onrender.com/analyze-pattern"
echo "🔍 Pattern Analysis API: https://detea-backend.onrender.com/analyze-pattern"
echo "🔗 Proxying to RunPod: https://rr9rd9oc5khoyk-11434.proxy.runpod.net/"
echo ""

# Start the server
node cors-proxy-server.js
