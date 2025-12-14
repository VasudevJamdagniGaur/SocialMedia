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
echo "🌐 Server will be available at: http://localhost:3001"
echo "💬 Chat API: http://localhost:3001/api/chat"
echo "🧠 Emotional Analysis API: http://localhost:3001/api/emotional-analysis"
echo "🔍 Pattern Analysis API: http://localhost:3001/api/pattern-analysis"
echo "🔗 Proxying to RunPod: https://rr9rd9oc5khoyk-11434.proxy.runpod.net/"
echo ""

# Start the server
node cors-proxy-server.js
