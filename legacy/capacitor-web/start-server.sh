#!/bin/bash

# Deite Backend Startup Script
# This script starts the Deite backend server with Ollama warm-up

echo "🚀 Starting Deite Backend Server..."
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

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama is not installed. Please install Ollama first."
    exit 1
fi

# Check if Ollama is running
if ! curl -s http://127.0.0.1:11434/api/tags > /dev/null; then
    echo "⚠️  Ollama is not running. Starting Ollama..."
    ollama serve &
    sleep 5
fi

# Check if mistral:instruct model is available
if ! ollama list | grep -q "mistral:instruct"; then
    echo "⚠️  mistral:instruct model not found. Please pull it first:"
    echo "   ollama pull mistral:instruct"
    exit 1
fi

echo "✅ All prerequisites met!"
echo ""

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo "🔥 Starting server with Ollama warm-up..."
echo "🌐 Backend base URL: https://detea-backend.onrender.com"
echo "💬 Health check: https://detea-backend.onrender.com/health"
echo ""

# Start the server
npm start
