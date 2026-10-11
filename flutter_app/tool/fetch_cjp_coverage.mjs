/**
 * Standalone CJP coverage probe — no Flutter/FFI.
 * Mirrors Tea event googleQueries + PullPush Reddit search.
 */
import https from 'https';
import { URL } from 'url';

const queries = [
  '("Cockroach Janta Party" OR CJP) (protest OR rally OR "Jantar Mantar") when:14d',
  '("Jantar Mantar") (protest OR CJP OR "Cockroach Janta") when:14d',
  '("Gyanesh Kumar" OR CEC) (resign OR resignation OR CJP OR protest) when:14d',
  '("Special Intensive Revision" OR SIR) (voter OR electoral OR roll) (protest OR CJP) when:14d',
  '(CJP OR "Cockroach Janta") (Mumbai OR Bengaluru OR Bangalore OR Ahmedabad OR Delhi) protest when:14d',
];

const redditQ = 'CJP OR "Cockroach Janta" OR "Jantar Mantar" protest OR "Gyanesh Kumar"';

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': 'DeiteNews/1.0 (+https://deitedatabase.web.app)',
          Accept: '*/*',
          ...headers,
        },
        timeout: 12000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function parseRssTitles(xml) {
  const items = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks.slice(0, 12)) {
    const title = (chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/is) ||
      chunk.match(/<title>(.*?)<\/title>/is) || [,''])[1]
      .replace(/<[^>]+>/g, '')
      .trim();
    const link = (chunk.match(/<link>(.*?)<\/link>/is) || [,''])[1].trim();
    const pub = (chunk.match(/<pubDate>(.*?)<\/pubDate>/is) || [,''])[1].trim();
    if (title) items.push({ title, link, pub });
  }
  return items;
}

async function main() {
  const seen = new Set();
  const all = [];
  console.log('=== Google News RSS (CJP event queries) ===');
  for (const q of queries) {
    const url =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent(q) +
      '&hl=en-IN&gl=IN&ceid=IN:en';
    try {
      const { status, body } = await get(url);
      const items = status === 200 ? parseRssTitles(body) : [];
      console.log(`\n[q] ${q}\n  status=${status} items=${items.length}`);
      for (const it of items.slice(0, 5)) {
        console.log(`  - ${it.title}`);
        if (!seen.has(it.link || it.title)) {
          seen.add(it.link || it.title);
          all.push(it);
        }
      }
    } catch (e) {
      console.log(`\n[q] ${q}\n  ERROR ${e.message}`);
    }
  }

  console.log('\n=== PullPush Reddit ===');
  try {
    const url =
      'https://api.pullpush.io/reddit/search/submission/?q=' +
      encodeURIComponent(redditQ) +
      '&size=15&sort=desc&sort_type=created_utc';
    const { status, body } = await get(url, { Accept: 'application/json' });
    console.log(`status=${status}`);
    if (status === 200) {
      const json = JSON.parse(body);
      const data = json.data || [];
      console.log(`posts=${data.length}`);
      for (const p of data.slice(0, 8)) {
        console.log(`  - r/${p.subreddit}: ${p.title}`);
      }
    } else {
      console.log(body.slice(0, 200));
    }
  } catch (e) {
    console.log('ERROR', e.message);
  }

  console.log(`\n=== UNIQUE RSS HITS: ${all.length} ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
