const { createProxyMiddleware } = require('http-proxy-middleware');

// CRA dev-server proxy so the browser can call `/api/news/*` on localhost
// while the dev server fetches the Firebase Hosting-backed endpoint server-side.
module.exports = function setupProxy(app) {
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
