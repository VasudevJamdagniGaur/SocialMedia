/**
 * Fetch top-level Reddit comments for a post using public .json endpoints (no API key).
 * Uses the same CORS proxy fallbacks as TrendingTea when the browser cannot reach Reddit directly.
 */

function withTimeoutSignal(ms, outerSignal) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(tid);
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
    },
  };
}

async function fetchRedditJsonViaProxies(targetUrl, { signal } = {}) {
  const encoded = encodeURIComponent(targetUrl);
  const attempts = [
    `https://api.codetabs.com/v1/proxy?quest=${encoded}`,
    `https://corsproxy.io/?${encoded}`,
    `https://api.allorigins.win/get?url=${encoded}`,
  ];
  for (const proxyUrl of attempts) {
    try {
      const res = await fetch(proxyUrl, {
        method: 'GET',
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      if (proxyUrl.includes('allorigins')) {
        const j = await res.json().catch(() => null);
        const txt = typeof j?.contents === 'string' ? j.contents : '';
        if (!txt) continue;
        const parsed = JSON.parse(txt);
        if (parsed && typeof parsed === 'object') return parsed;
        continue;
      }
      const json = await res.json().catch(() => null);
      if (json && typeof json === 'object') return json;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
    }
  }
  return null;
}

/** @param {string} discussionUrl e.g. https://www.reddit.com/r/foo/comments/id/slug/ */
export function buildRedditThreadJsonUrl(discussionUrl) {
  if (typeof discussionUrl !== 'string' || !discussionUrl.trim()) return null;
  const u = discussionUrl.trim().replace(/\/?(\?.*)?$/, '');
  if (!/reddit\.com\/r\//i.test(u)) return null;
  return `${u}.json?raw_json=1&limit=50&depth=1&sort=top`;
}

/**
 * @param {unknown} threadJson Reddit array [postListing, commentsListing]
 * @param {number} limit
 * @returns {{ id: string, author: string, body: string, score: number }[]}
 */
export function parseTopLevelComments(threadJson, limit = 40) {
  const listing = threadJson?.[1]?.data?.children;
  if (!Array.isArray(listing)) return [];

  const rows = [];
  for (const child of listing) {
    if (child?.kind !== 't1') continue;
    const d = child.data;
    if (!d || d.stickied) continue;
    const body = typeof d.body === 'string' ? d.body.trim() : '';
    if (!body || body === '[deleted]' || body === '[removed]') continue;
    const author = typeof d.author === 'string' && d.author.length ? d.author : 'unknown';
    const score = typeof d.score === 'number' ? d.score : 0;
    const id = typeof d.id === 'string' ? d.id : String(rows.length);
    rows.push({ id, author, body, score });
  }

  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}

/** Collapse whitespace for one-line preview */
export function compactCommentBody(text, maxLen = 220) {
  const t = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/**
 * @param {string} discussionUrl Full permalink to the Reddit post
 * @param {{ signal?: AbortSignal }} opts
 */
export async function fetchTeaThreadComments(discussionUrl, opts = {}) {
  const jsonUrl = buildRedditThreadJsonUrl(discussionUrl);
  if (!jsonUrl) {
    return { ok: false, comments: [], error: 'Invalid discussion URL' };
  }

  const t = withTimeoutSignal(12000, opts.signal);
  try {
    let threadJson = null;
    try {
      const res = await fetch(jsonUrl, {
        signal: t.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.ok) {
        threadJson = await res.json().catch(() => null);
      }
    } catch {
      /* CORS / network — try proxies */
    }
    if (!threadJson) {
      threadJson = await fetchRedditJsonViaProxies(jsonUrl, { signal: t.signal });
    }
    if (!threadJson || !Array.isArray(threadJson)) {
      return { ok: false, comments: [], error: 'Could not load comments' };
    }
    const comments = parseTopLevelComments(threadJson, 40);
    return { ok: true, comments, error: null };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { ok: false, comments: [], error: 'aborted' };
    }
    return { ok: false, comments: [], error: e instanceof Error ? e.message : 'Failed' };
  } finally {
    t.cleanup();
  }
}
