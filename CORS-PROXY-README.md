# CORS Proxy Server Setup

## Problem
The browser blocks direct requests to the RunPod API due to CORS (Cross-Origin Resource Sharing) restrictions. This proxy server solves that issue.

## Solution
A simple Node.js proxy server that forwards requests to RunPod and adds CORS headers.

## Quick Start

### Option 1: Using the Startup Script (Recommended)

**Windows:**
```bash
start-cors-proxy.bat
```

**Mac/Linux:**
```bash
chmod +x start-cors-proxy.sh
./start-cors-proxy.sh
```

### Option 2: Manual Start

1. Make sure Node.js is installed (v14 or higher)
2. Open a terminal in the project root
3. Run:
```bash
node cors-proxy-server.js
```

The backend used by the frontend is `https://detea-backend.onrender.com`

## How It Works

1. The proxy server runs locally
2. Your frontend makes requests to your deployed backend (recommended)
3. The proxy forwards the request to RunPod with CORS headers
4. The response is sent back to your frontend

## Services Updated

The following services now use the proxy:
- `emotionalAnalysisService.js` - For emotional analysis
- `habitAnalysisService.js` - For habit analysis

Both services handle errors gracefully.

## Troubleshooting

### Port Already in Use
If you see "Port 3001 is already in use":
- Stop any other server running on port 3001
- Or change the PORT in `cors-proxy-server.js`

### Proxy Not Working
- Make sure the server is running
- Check the console for error messages
- The services will automatically fallback to direct URL (may still have CORS issues)

### Still Getting CORS Errors
- Make sure the proxy server is running
- Check that requests are going to your backend origin
- Restart the proxy server
- Clear browser cache

## Production Deployment

For production, you should:
1. Deploy the proxy server to a backend service
2. Update the `proxyURL` in the services to point to your production proxy
3. Or configure CORS on your RunPod server directly
