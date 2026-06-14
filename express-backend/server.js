/**
 * Deite Reddit proxy — Flutter (web/mobile) → Express → Reddit API
 *
 * Run: npm install && npm start  (default PORT=3002)
 * Flutter web: flutter run -d chrome --dart-define=BACKEND_URL=http://localhost:3002
 */
const express = require('express');
const cors = require('cors');

const PORT = Number(process.env.PORT) || 3002;
const REDDIT_UA = process.env.REDDIT_USER_AGENT ||
  'DeteaRedditProxy/1.0 (+https://deitedatabase.web.app)';

const app = express();
app.use(cors());
app.use(express.json());

function sanitizeSub(sub) {
  return String(sub || 'BollyBlindsNGossip').replace(/[^A-Za-z0-9_]/g, '') || 'BollyBlindsNGossip';
}

function clampLimit(limit) {
  const n = parseInt(limit, 10);
  if (Number.isNaN(n)) return 50;
  return Math.min(100, Math.max(1, n));
}

function redditHotUrl(sub, limit) {
  return `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=${limit}&raw_json=1`;
}

function isAllowedRedditJsonUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.endsWith('reddit.com') && u.pathname.endsWith('.json');
  } catch {
    return false;
  }
}

async function fetchReddit(targetUrl) {
  const res = await fetch(targetUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': REDDIT_UA,
    },
  });
  const body = await res.text();
  return { status: res.status, body };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'detea-reddit-proxy' });
});

function parseRedditHotRss(xml) {
  const items = [];
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const block of blocks) {
    const titleM = block.match(/<title(?:[^>]*)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkM = block.match(/<link[^>]+href="([^"]+)"/i);
    const thumbM = block.match(/<media:thumbnail[^>]+url="([^"]+)"/i);
    const title = titleM ? titleM[1].replace(/&amp;/g, '&').trim() : '';
    const url = linkM ? linkM[1].trim() : '';
    if (!title || !url) continue;
    const lower = title.toLowerCase();
    if (
      lower.includes('fanclub-style') ||
      lower.includes('how can members help mods') ||
      lower.includes('why we don') ||
      title.includes('AutoModerator')
    ) {
      continue;
    }
    items.push({
      title,
      url,
      image: thumbM ? thumbM[1] : '',
      thumbnail: thumbM ? thumbM[1] : '',
      score: 0,
      num_comments: 0,
      author: 'r/BollyBlindsNGossip',
      source: 'r/BollyBlindsNGossip',
    });
    if (items.length >= 15) break;
  }
  return items;
}

function buildRedditThreadJsonUrl(discussionUrl) {
  try {
    const u = new URL(discussionUrl.trim().replace(/\/?\?.*$/, '').replace(/\/$/, ''));
    let host = u.hostname.toLowerCase();
    if (host.startsWith('np.') || host.startsWith('old.')) host = 'www.reddit.com';
    if (!host.endsWith('reddit.com')) return null;
    let path = u.pathname;
    if (!/\/comments\/[a-z0-9]+/i.test(path)) return null;
    if (!path.endsWith('.json')) path = `${path}.json`;
    u.hostname = host;
    u.pathname = path;
    u.search = '?raw_json=1&limit=120&depth=2&sort=top';
    return u.toString();
  } catch {
    return null;
  }
}

function parseRedditThreadPayload(threadJson, seedUrl) {
  if (!Array.isArray(threadJson) || !threadJson.length) return null;
  const listing0 = threadJson[0]?.data?.children?.[0]?.data;
  if (!listing0?.title) return null;

  const title = String(listing0.title || '').trim();
  const permalink = listing0.permalink
    ? `https://www.reddit.com${listing0.permalink.startsWith('/') ? '' : '/'}${listing0.permalink}`
    : String(seedUrl || '').trim();
  const selftext = String(listing0.selftext || '').trim();
  const subreddit = String(listing0.subreddit_name_prefixed || '').trim();

  const comments = [];
  const children = threadJson[1]?.data?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (comments.length >= 8) break;
      if (child?.kind !== 't1') continue;
      const body = String(child?.data?.body || '').trim();
      if (!body || body === '[removed]' || body === '[deleted]') continue;
      comments.push({
        author: String(child.data.author || 'unknown'),
        body,
      });
    }
  }

  let image = null;
  try {
    const src = listing0?.preview?.images?.[0]?.source?.url;
    if (src && /^https?:/i.test(src)) image = src.replace(/&amp;/g, '&');
  } catch (_) {}
  const link = String(listing0.url || '').trim();
  if (!image && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(link.split('?')[0])) image = link;
  const thumb = String(listing0.thumbnail || '').trim();
  if (!image && /^https?:/i.test(thumb) && !['self', 'default', 'nsfw', 'spoiler'].includes(thumb)) {
    image = thumb;
  }

  const gossipParts = [];
  if (selftext) gossipParts.push(selftext.replace(/\s+/g, ' ').trim());
  for (const c of comments.slice(0, 4)) {
    const b = c.body.replace(/\s+/g, ' ').trim();
    if (b.length > 20) gossipParts.push(b);
  }
  let gossip = gossipParts.join(' ').trim();
  if (!gossip) gossip = title;

  const chunks = [];
  if (subreddit) chunks.push(`Subreddit: ${subreddit}`);
  chunks.push(`Title: ${title}`);
  if (selftext) chunks.push(`Post body:\n${selftext}`);
  if (comments.length) {
    chunks.push(
      `Top comments:\n${comments.map((c) => `Comment by u/${c.author}: ${c.body}`).join('\n\n')}`
    );
  }
  const text = chunks.join('\n\n').trim();
  if (text.length < 12) return null;

  return {
    title,
    url: permalink,
    image,
    selftext: selftext.replace(/\s+/g, ' ').trim(),
    gossip,
    description: gossip,
    source: subreddit || 'Reddit',
    text: text.length > 16000 ? text.slice(0, 16000) : text,
    thread: threadJson,
  };
}

/** Parsed Reddit thread — title, gossip, image, comment text */
app.get('/api/reddit/thread', async (req, res) => {
  const discussionUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!discussionUrl) {
    return res.status(400).json({ ok: false, error: 'missing_url' });
  }
  const jsonUrl = buildRedditThreadJsonUrl(discussionUrl);
  if (!jsonUrl) {
    return res.status(400).json({ ok: false, error: 'invalid_reddit_url' });
  }
  try {
    const { status, body } = await fetchReddit(jsonUrl);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: 'thread_fetch_failed' });
    }
    const threadJson = JSON.parse(body);
    const parsed = parseRedditThreadPayload(threadJson, discussionUrl);
    if (!parsed) {
      return res.status(502).json({ ok: false, error: 'thread_parse_failed' });
    }
    res.json({ ok: true, ...parsed });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Fresh Tea feed via YouTube Data API — India-first: Bollywood, cricket, local entertainment */
const TEA_YT_QUERIES = [
  'bollywood gossip celebrity news india latest',
  'bollywood controversy drama india hindi',
  'IPL cricket highlights news india',
  'indian cricket team sports news',
  'tollywood kollywood sandalwood gossip india',
  'indian celebrity entertainment news hindi',
];

const TEA_YT_INTERNATIONAL_SIGNALS = [
  'hollywood',
  'kardashian',
  'taylor swift',
  'nba ',
  ' nfl',
  'premier league',
  'manchester united',
  'real madrid',
  'barcelona fc',
  'uk royal',
  'white house',
  'fox news',
  'cnn breaking',
  'k-pop',
  'kpop',
  'marvel studios',
  'disney world',
  'eurovision',
  'grammy awards',
];

const TEA_YT_INDIAN_SIGNALS = [
  'bollywood',
  'india',
  'indian',
  'hindi',
  'cricket',
  'ipl',
  'bcci',
  'tollywood',
  'kollywood',
  'sandalwood',
  'mumbai',
  'delhi',
  'bigg boss',
  'filmfare',
  'box office',
  'crore',
  'lakh',
  'virat',
  'dhoni',
  'rohit sharma',
  'ind vs',
  'india vs',
  'star sports',
  'hotstar',
];

function isRelevantIndianTeaYouTubeContent(title, description = '', channel = '') {
  const blob = `${title} ${description} ${channel}`.toLowerCase();
  if (!blob.trim()) return false;
  const hasIndiaLean = TEA_YT_INDIAN_SIGNALS.some((s) => blob.includes(s));
  if (!hasIndiaLean) return false;
  const looksInternational = TEA_YT_INTERNATIONAL_SIGNALS.some((s) => blob.includes(s));
  if (looksInternational && !TEA_YT_INDIAN_SIGNALS.some((s) => blob.includes(s))) return false;
  return true;
}

function teaYouTubePublishedAfter() {
  return new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function bestYouTubeThumb(thumbnails) {
  if (!thumbnails || typeof thumbnails !== 'object') return '';
  for (const key of ['maxres', 'high', 'medium', 'default']) {
    const url = thumbnails[key]?.url;
    if (url && /^https?:/i.test(url)) return url;
  }
  return '';
}

async function fetchYouTubeTeaItems(apiKey, maxKeep) {
  const seen = new Set();
  const rows = [];

  for (const query of TEA_YT_QUERIES) {
    if (rows.length >= maxKeep) break;
    const perQuery = Math.min(25, Math.max(8, maxKeep * 2));
    const searchParams = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      order: 'date',
      q: query,
      maxResults: String(perQuery),
      regionCode: 'IN',
      relevanceLanguage: 'hi',
      publishedAfter: teaYouTubePublishedAfter(),
      key: apiKey,
    });
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${searchParams}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!searchRes.ok) continue;
    const searchBody = await searchRes.json();
    const items = Array.isArray(searchBody.items) ? searchBody.items : [];
    const videoIds = [];
    for (const item of items) {
      const vid = item?.id?.videoId;
      if (!vid || seen.has(vid)) continue;
      videoIds.push(vid);
    }
    if (!videoIds.length) continue;

    const statsParams = new URLSearchParams({
      part: 'statistics,snippet',
      id: videoIds.join(','),
      key: apiKey,
    });
    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${statsParams}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!statsRes.ok) continue;
    const statsBody = await statsRes.json();
    const statItems = Array.isArray(statsBody.items) ? statsBody.items : [];

    for (const statItem of statItems) {
      if (rows.length >= maxKeep) break;
      const vid = statItem?.id;
      if (!vid || seen.has(vid)) continue;
      const snippet = statItem.snippet || {};
      const title = String(snippet.title || '').trim();
      if (!title) continue;
      const description = String(snippet.description || '').trim();
      const channel = String(snippet.channelTitle || 'YouTube').trim();
      if (!isRelevantIndianTeaYouTubeContent(title, description, channel)) continue;
      const gossip = description.length > 320
        ? `${description.slice(0, 320).trimEnd()}…`
        : (description || title);
      const channelName = channel;
      const image = bestYouTubeThumb(snippet.thumbnails);
      const views = parseInt(statItem.statistics?.viewCount || '0', 10) || 0;
      const comments = parseInt(statItem.statistics?.commentCount || '0', 10) || 0;
      seen.add(vid);
      rows.push({
        title,
        url: `https://www.youtube.com/watch?v=${vid}`,
        image,
        thumbnail: image,
        score: views,
        num_comments: comments,
        author: channelName || 'YouTube',
        source: 'YouTube',
        description: gossip,
        gossip,
        selftext: description || title,
        videoId: vid,
      });
    }
  }

  rows.sort((a, b) => (b.score || 0) - (a.score || 0));
  return rows.slice(0, maxKeep);
}

app.get('/api/youtube/tea', async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY || '';
  if (!apiKey) {
    return res.status(503).json({ ok: false, items: [], error: 'youtube_not_configured' });
  }
  const maxKeep = clampLimit(req.query.limit || 12);
  try {
    const items = await fetchYouTubeTeaItems(apiKey, maxKeep);
    res.json({ ok: true, items });
  } catch (err) {
    res.status(502).json({
      ok: false,
      items: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Fresh Tea feed via Reddit Atom RSS (works when JSON API is blocked) */
app.get('/api/reddit/tea', async (req, res) => {
  const sub = sanitizeSub(req.query.sub);
  const limit = clampLimit(req.query.limit);
  const rssUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot/.rss?limit=${limit}`;
  try {
    const { status, body } = await fetchReddit(rssUrl);
    if (status !== 200) {
      return res.status(status).json({ ok: false, items: [], error: 'rss_fetch_failed' });
    }
    const items = parseRedditHotRss(body);
    res.json({ ok: true, items });
  } catch (err) {
    res.status(502).json({
      ok: false,
      items: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Primary Tea/Pod endpoint — Flutter calls this on web */
app.get('/api/reddit/hot', async (req, res) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  const sub = sanitizeSub(req.query.sub);
  const limit = clampLimit(req.query.limit);
  const target = redditHotUrl(sub, limit);
  try {
    const { status, body } = await fetchReddit(target);
    res.status(status).type('application/json').send(body);
  } catch (err) {
    res.status(502).json({
      error: 'reddit_proxy_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Legacy passthrough — ?url=https://www.reddit.com/r/.../hot.json */
app.get('/api/news', async (req, res) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  const custom = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  const target = custom && isAllowedRedditJsonUrl(custom)
    ? custom
    : redditHotUrl('WorldNewsHeadlines', 45);
  try {
    const { status, body } = await fetchReddit(target);
    res.status(status).type('application/json').send(body);
  } catch (err) {
    res.status(502).json({
      error: 'reddit_proxy_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Deite Reddit proxy listening on http://localhost:${PORT}`);
  console.log('  GET /api/reddit/tea?sub=BollyBlindsNGossip&limit=20');
  console.log('  GET /api/reddit/hot?sub=BollyBlindsNGossip&limit=50');
  console.log('  GET /api/reddit/thread?url=<reddit permalink>');
  console.log('  GET /api/news?url=<reddit.json>');
});
