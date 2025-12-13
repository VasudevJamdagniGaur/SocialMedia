# Deite Backend Server

A Node.js + Express backend server for the Deite AI chat application with integrated Ollama warm-up system to eliminate cold start delays.

## Features

- **Ollama Warm-up System**: Automatically preloads `mistral:instruct` model into GPU memory on startup
- **Keep-alive Ping**: Maintains model in GPU memory with periodic requests every 4 minutes
- **Instant Responses**: First user messages respond immediately (no 20-40 second cold start delay)
- **API Endpoints**: Chat, emotional analysis, and pattern analysis endpoints
- **Health Monitoring**: Built-in health check endpoint
- **Graceful Shutdown**: Properly stops keep-alive system on server shutdown

## Prerequisites

- Node.js (v14 or higher)
- Ollama running on RunPod (https://ypli6in7mq19s6-11434.proxy.runpod.net/)
- `llama3:70b` model available in Ollama
- RunPod RTX6000 pod (or similar GPU environment)

## Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Verify Ollama is running on RunPod**:
   ```bash
   curl https://ypli6in7mq19s6-11434.proxy.runpod.net/api/tags
   ```

3. **Verify mistral:instruct model is available**:
   ```bash
   curl https://ypli6in7mq19s6-11434.proxy.runpod.net/api/tags
   ```

## Usage

### Start the server:
```bash
npm start
```

### Development mode (with auto-restart):
```bash
npm run dev
```

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and model warm-up state.

### Chat
```
POST /api/chat
Content-Type: application/json

{
  "message": "Hello, how are you?",
  "conversationHistory": []
}
```

### Emotional Analysis
```
POST /api/emotional-analysis
Content-Type: application/json

{
  "messages": [
    {"role": "user", "content": "I'm feeling stressed about work"},
    {"role": "assistant", "content": "I understand you're feeling stressed..."}
  ]
}
```

### Pattern Analysis
```
POST /api/pattern-analysis
Content-Type: application/json

{
  "chatData": {...},
  "days": 30
}
```

## Ollama Warm-up System

The warm-up system consists of three main components:

### 1. Model Preloading
- Runs `ollama run mistral:instruct "Hello"` on server startup
- Loads the model into GPU memory in the background
- Prevents cold start delays for first user requests

### 2. Keep-alive Ping
- Sends periodic requests to `http://localhost:11434/api/generate` every 4 minutes
- Uses minimal prompts ("ping") to keep model active
- Prevents model from unloading during idle periods

### 3. Console Logging
- `🔥 Model warm-up started` - When warm-up begins
- `✅ Model is active in GPU memory` - When preloading succeeds
- `💓 Keep-alive ping successful` - When ping succeeds
- `⚠️ Keep-alive ping failed` - When ping fails (model may have unloaded)

## Configuration

You can modify these settings in `server.js`:

```javascript
const OLLAMA_BASE_URL = 'https://ypli6in7mq19s6-11434.proxy.runpod.net/';  // RunPod Ollama API URL
const MODEL_NAME = 'llama3:70b';              // Model to warm up
const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000;         // Ping interval (4 minutes)
```

## Troubleshooting

### Model not warming up
- Ensure Ollama is running on RunPod: `curl https://ypli6in7mq19s6-11434.proxy.runpod.net/api/tags`
- Check if model exists: `curl https://ypli6in7mq19s6-11434.proxy.runpod.net/api/tags`
- Verify RunPod Ollama API is accessible: `curl https://ypli6in7mq19s6-11434.proxy.runpod.net/api/tags`

### Keep-alive ping failures
- Check RunPod Ollama logs for errors
- Verify GPU memory is sufficient on RunPod
- Restart RunPod Ollama instance if needed

### Server startup issues
- Check Node.js version: `node --version`
- Install dependencies: `npm install`
- Check port availability (default: 3001)

## Integration with Frontend

Update your frontend services to use the new backend endpoints:

```javascript
// In your ChatService.js
const baseURL = 'http://localhost:3001'; // Your backend server

// Replace Ollama calls with backend API calls
const response = await fetch(`${baseURL}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, conversationHistory })
});
```

## Performance Benefits

- **Before**: First message takes 20-40 seconds (cold start)
- **After**: First message responds instantly (model preloaded)
- **Continuous**: Model stays active during idle periods
- **Resource Efficient**: Minimal keep-alive requests (1 token every 4 minutes)

## License

MIT
