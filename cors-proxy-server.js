const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3001;
const RUNPOD_BASE_URL = 'https://rr9rd9oc5khoyk-11434.proxy.runpod.net';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  // Set CORS headers for all responses
  Object.keys(corsHeaders).forEach(key => {
    res.setHeader(key, corsHeaders[key]);
  });

  // Parse the request URL
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);

  // Proxy /api/generate requests to RunPod
  if (path === '/api/generate' && req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const requestData = JSON.parse(body);
        const targetUrl = `${RUNPOD_BASE_URL}/api/generate`;
        
        console.log(`Proxying request to: ${targetUrl}`);
        
        const options = {
          hostname: url.parse(targetUrl).hostname,
          port: 443,
          path: '/api/generate',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        };

        const proxyReq = https.request(options, (proxyRes) => {
          let responseData = '';

          proxyRes.on('data', (chunk) => {
            responseData += chunk;
          });

          proxyRes.on('end', () => {
            res.writeHead(proxyRes.statusCode, {
              ...corsHeaders,
              'Content-Type': 'application/json'
            });
            res.end(responseData);
            console.log(`Response sent: ${proxyRes.statusCode}`);
          });
        });

        proxyReq.on('error', (error) => {
          console.error('Proxy request error:', error);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ error: 'Proxy request failed', message: error.message }));
        });

        proxyReq.setTimeout(120000, () => {
          proxyReq.destroy();
          res.writeHead(504, corsHeaders);
          res.end(JSON.stringify({ error: 'Request timeout' }));
        });

        proxyReq.write(body);
        proxyReq.end();

      } catch (error) {
        console.error('Error parsing request:', error);
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Invalid request', message: error.message }));
      }
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      res.writeHead(500, corsHeaders);
      res.end(JSON.stringify({ error: 'Request error', message: error.message }));
    });

  } else {
    res.writeHead(404, corsHeaders);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`🚀 CORS Proxy Server running on http://localhost:${PORT}`);
  console.log(`📡 Proxying requests to: ${RUNPOD_BASE_URL}`);
  console.log(`✅ Ready to handle /api/generate requests`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please stop the other server or change the port.`);
  } else {
    console.error('Server error:', error);
  }
});
