const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * CRA does not always populate process.env from .env before setupProxy runs.
 * Read project root .env so REACT_APP_NEWSAPI* is available for the local proxy.
 */
/** Keys needed before CRA injects env into the client bundle (setupProxy runs in Node only). */
const ENV_KEYS_FOR_PROXY = new Set([
  'NEWSAPI_KEY',
  'NEWSAPI_API_KEY',
  'REACT_APP_NEWSAPI',
  'REACT_APP_NEWS_API_KEY',
  'REACT_APP_NEWSAPI_KEY',
  'REACT_APP_NEWS_PROXY_ORIGIN',
]);

function loadRootEnvFile() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      let s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq < 1) continue;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (ENV_KEYS_FOR_PROXY.has(key) || key.startsWith('REACT_APP_')) {
        process.env[key] = val;
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Server-side GET for NewsAPI (same idea as Cloud Function `newsApi`).
 * CRA dev client cannot call newsapi.org directly (CORS); this runs in Node on the dev server.
 */
function httpsGetJson(urlString) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      urlString,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'DeiteNews/1.0 (+https://deitedatabase.web.app)',
        },
      },
      (incoming) => {
        let buf = '';
        incoming.on('data', (c) => {
          buf += c;
        });
        incoming.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(buf);
          } catch {
            json = null;
          }
          resolve({
            status: incoming.statusCode || 0,
            ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
            json,
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function readLocalNewsApiKey() {
  return (
    process.env.NEWSAPI_KEY ||
    process.env.NEWSAPI_API_KEY ||
    process.env.REACT_APP_NEWSAPI ||
    process.env.REACT_APP_NEWS_API_KEY ||
    process.env.REACT_APP_NEWSAPI_KEY ||
    ''
  ).trim();
}

const DEBUG_LOG = path.join(__dirname, '..', '.cursor', 'debug-db6096.log');

function appendProxyDebug(payload) {
  try {
    fs.appendFileSync(
      DEBUG_LOG,
      `${JSON.stringify({
        sessionId: 'db6096',
        timestamp: Date.now(),
        location: 'setupProxy.js',
        runId: 'localhost-proxy',
        ...payload,
      })}\n`,
      'utf8'
    );
  } catch {
    /* no .cursor dir or permissions */
  }
}

/**
 * If .env has REACT_APP_NEWSAPI*, answer /api/news/* locally so Trending/Sports work
 * without relying on Firebase Hosting + Functions (often unset in dev).
 */
function mountLocalNewsApiProxy(app) {
  const localKey = readLocalNewsApiKey();
  if (!localKey) {
    appendProxyDebug({
      message: 'local_news_proxy_skipped',
      hypothesisId: 'H1',
      data: { reason: 'no_api_key_in_env' },
    });
    return;
  }

  appendProxyDebug({
    message: 'local_news_proxy_active',
    hypothesisId: 'H1',
    data: { hasKey: true },
  });

  const handler = (endpoint) => async (req, res, next) => {
    try {
      const upstream = new URL(`https://newsapi.org/v2/${endpoint}`);
      for (const [k, v] of Object.entries(req.query || {})) {
        if (k === 'endpoint' || k === 'apiKey') continue;
        const val = Array.isArray(v) ? v[0] : v;
        if (val != null && String(val).length) upstream.searchParams.set(k, String(val));
      }
      upstream.searchParams.set('apiKey', localKey);
      const { status, json } = await httpsGetJson(upstream.toString());
      if (!json || typeof json !== 'object') {
        appendProxyDebug({
          message: 'local_news_upstream_bad_json',
          hypothesisId: 'H1',
          data: { endpoint, status },
        });
        return next();
      }
      appendProxyDebug({
        message: 'proxy_response',
        hypothesisId: 'H1',
        data: {
          baseHost: 'localhost-dev-server',
          endpoint,
          http: status,
          apiStatus: json.status,
          apiCode: json.code,
          articleCount: Array.isArray(json.articles) ? json.articles.length : null,
        },
      });
      res.status(status || 502).json(json);
    } catch (e) {
      appendProxyDebug({
        message: 'local_news_proxy_error',
        hypothesisId: 'H1',
        data: { endpoint, err: String(e && e.message ? e.message : e) },
      });
      next();
    }
  };

  app.get('/api/news/everything', handler('everything'));
  app.get('/api/news/top-headlines', handler('top-headlines'));
}

// CRA dev-server proxy so the browser can call `/api/news/*` on localhost
// while the dev server fetches the Firebase Hosting-backed endpoint server-side.
module.exports = function setupProxy(app) {
  loadRootEnvFile();
  mountLocalNewsApiProxy(app);

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
      onProxyReq(proxyReq) {
        proxyReq.setHeader('Accept', 'application/json');
      },
      onError(err, req, res) {
        appendProxyDebug({
          message: 'hosting_proxy_error',
          hypothesisId: 'H1',
          data: { targetOrigin, err: err && err.message ? err.message : String(err) },
        });
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'error',
              code: 'proxy_error',
              message:
                'Dev server could not reach hosting NewsAPI proxy. Set NEWSAPI_KEY or REACT_APP_NEWSAPI in .env for direct NewsAPI from localhost.',
            })
          );
        }
      },
    })
  );
};
