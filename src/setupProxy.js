const fs = require('fs');
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

function resolveDebugLogFile() {
  const cwd = process.cwd();
  const base = path.basename(cwd);
  if (base === 'deite-frontend') {
    return path.join(cwd, '..', '.cursor', 'debug-db6096.log');
  }
  return path.join(cwd, '.cursor', 'debug-db6096.log');
}

const DEBUG_LOG_FILE = resolveDebugLogFile();

function appendDebugNdjsonLine(body) {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_FILE), { recursive: true });
    const line = `${JSON.stringify(body && typeof body === 'object' ? body : {})}\n`;
    fs.appendFileSync(DEBUG_LOG_FILE, line, 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[setupProxy] __debug/ingest write failed:', e?.message || e);
  }
}

// CRA dev-server proxy so the browser can call `/api/news/*` on localhost
// while the dev server fetches the Firebase Hosting-backed endpoint server-side.
module.exports = function setupProxy(app) {
  // Writes NDJSON to .cursor/debug-db6096.log when the app POSTs here (localhost only).
  // Cursor's 127.0.0.1:7490 ingest is often offline; this keeps a file on disk for debug mode.
  app.post('/__debug/ingest', express.json({ limit: '512kb' }), (req, res) => {
    appendDebugNdjsonLine(req.body);
    res.status(204).end();
  });

  const targetOrigin = (
    process.env.REACT_APP_NEWS_PROXY_ORIGIN || 'https://deitedatabase.web.app'
  ).replace(/\/$/, '');

  app.use(
    '/api/news',
    createProxyMiddleware({
      target: targetOrigin,
      changeOrigin: true,
      secure: true,
      logLevel: 'silent',
    })
  );
};

