const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = 3001;
const UPSTREAM =
  'https://www.reddit.com/r/WorldNewsHeadlines/hot.json?limit=45&raw_json=1';

app.get('/api/news', async (_req, res) => {
  try {
    const upstreamRes = await fetch(UPSTREAM, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'DeteaLocalDev/1.0.0',
      },
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => '');
      return res.status(upstreamRes.status).json({
        error: 'Upstream Reddit request failed',
        status: upstreamRes.status,
        details: text ? text.slice(0, 500) : undefined,
      });
    }

    const data = await upstreamRes.json();
    return res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Proxy server error', message });
  }
});

app.listen(PORT, () => {
  console.log(`Detea proxy listening on http://localhost:${PORT}`);
});

