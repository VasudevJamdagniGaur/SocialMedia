import chatService from '../services/chatService';
import {
  googleNewsSearchUrl,
  canFetchLiveNews,
  fetchJsonGet,
  fetchNewsApiEverythingNormalized,
  fetchNewsApiTopHeadlinesNormalized,
  fetchLiveFromGoogleRssByQuery,
  enrichNewsItemsWithOgImages,
  isNewsApiRateLimitedCooldown,
} from './podTopicNewsShared';

/** Google News browse queries (for “Open on Google News” links only). */
export const GOOGLE_BROWSE_QUERY = {
  cricket: 'cricket OR IPL OR T20 OR Ashes',
  football: '"Major League Soccer" OR MLS OR NWSL OR USMNT OR USWNT OR "US Soccer"',
  f1: '"Formula 1" OR F1 OR "Grand Prix"',
  chess: 'chess OR FIDE OR grandmaster OR Candidates',
  others: 'sports',
};

export const POD_SPORTS_EXPLORE_SLUGS = ['cricket', 'football', 'f1', 'chess', 'others'];

/** Hot-feed subreddits per Explore tab (fetched via `fetchJsonGet` → reddit.com/r/{sub}/hot.json). */
export const REDDIT_SPORTS_SUBS = {
  cricket: ['Cricket', 'IndianCricket', 'IndiaCricketGossips'],
  football: ['Championship', 'Soccer', 'Football', 'PremierLeague', 'Soccercirclejerk'],
  f1: ['formula1', 'F1Discussions', 'formuladank', 'F1FeederSeries', 'GrandPrixRacing'],
  chess: ['chess', 'TournamentChess', 'AnarchyChess', 'chessmemes'],
  others: ['sports', 'sportsdiscussion', 'sportsarefun'],
};

export const TOPIC_META = {
  cricket: {
    label: 'Cricket',
    q: '(cricket OR IPL OR "test cricket" OR T20 OR BBL OR PSL OR Ashes OR wicket)',
  },
  football: {
    label: 'Football',
    q: '("Major League Soccer" OR MLS OR NWSL OR USMNT OR USWNT OR "US Soccer" OR "U.S. Soccer" OR "Inter Miami" OR LAFC OR "LA Galaxy" OR "Atlanta United" OR "Seattle Sounders" OR "Leagues Cup")',
  },
  f1: {
    label: 'F1',
    q: '("Formula 1" OR "Formula One" OR F1 OR "Grand Prix" OR qualifying OR pitwall OR constructors)',
  },
  chess: {
    label: 'Chess',
    q: '(chess OR FIDE OR grandmaster OR Carlsen OR Nakamura OR Candidates OR lichess OR Chess.com)',
  },
  others: {
    label: 'Other sports',
    q: null,
  },
};

export function getSportsTopicLabel(topicId) {
  return TOPIC_META[topicId]?.label ?? 'Sports';
}

/** Keep only articles that clearly belong to the sports tab (NewsAPI “everything” often returns noise). */
export function sportArticleMatchesTopic(topicId, item) {
  const blob = `${item?.title || ''} ${item?.description || ''}`;
  if (!blob.trim()) return false;
  switch (topicId) {
    case 'cricket':
      return (
        /\b(cricket|cricketer|cricketers|cricketing)\b/i.test(blob) ||
        /\b(ipl|wpl|psl|bbl|cpl|ilt20|sa20)\b/i.test(blob) ||
        /\b(ashes|wicket|wickets|super over|follow[- ]on)\b/i.test(blob) ||
        /\b(t20|t-20|twenty-?20)\b/i.test(blob) ||
        /\b(odi|one[- ]day international|one[- ]dayers)\b/i.test(blob) ||
        /\b(test match|test series|pink[- ]ball|day[- ]night test)\b/i.test(blob) ||
        /\b(bcci|pcb\b|slc|nzc)\b/i.test(blob) ||
        /\b(batsman|batsmen|batters?|bowlers?|stumping|lbw|googly|yorker|bouncer|maiden)\b/i.test(blob)
      );
    case 'football': {
      if (
        /\b(nfl|super bowl|touchdown|quarterback|ncaa football|nfl draft|afc championship|nfc championship|gridiron)\b/i.test(
          blob
        ) &&
        !/\b(soccer|mls|nwsl|fifa|goalkeeper|usmnt|uswnt)\b/i.test(blob)
      ) {
        return false;
      }
      const mlsNwslFed =
        /\b(mls|nwsl|major league soccer|national women's soccer league)\b/i.test(blob) ||
        /\b(usmnt|uswnt)\b/i.test(blob) ||
        /\b(us soccer|u\.s\. soccer|ussf|united states soccer federation)\b/i.test(blob);
      const usNatTeam =
        /\bsoccer\b/i.test(blob) &&
        /\b(united states|u\.s\.|usa)\b/i.test(blob) &&
        /\b(men'?s national|women'?s national|national team)\b/i.test(blob);
      const mlsClub =
        /\b(inter miami|lafc|la galaxy|atlanta united|seattle sounders|portland timbers|orlando city|philadelphia union|austin fc|st\.?\s*louis city sc|columbus crew|sporting kansas city|new york city fc|nycfc|dc united|chicago fire|minnesota united|houston dynamo|fc dallas|colorado rapids|real salt lake|san jose earthquakes|vancouver whitecaps|toronto fc|cf montreal|new england revolution|nashville sc|charlotte fc|red bulls|rb ny)\b/i.test(
          blob
        );
      const usCup =
        /\b(leagues cup|gold cup)\b/i.test(blob) &&
        /\b(united states|u\.s\.|usa|usmnt|uswnt|american)\b/i.test(blob);
      const soccerInAmerica =
        /\bsoccer\b/i.test(blob) &&
        /\b(united states|u\.s\.|usa|american|mls|nwsl|usmnt|uswnt)\b/i.test(blob);
      return !!(mlsNwslFed || usNatTeam || mlsClub || usCup || soccerInAmerica);
    }
    case 'f1':
      return (
        /\b(formula\s*1|formula one|\bf1\b)\b/i.test(blob) ||
        /\b(grand prix|qualifying|paddock|constructor|pit stop|pole position)\b/i.test(blob) ||
        /\b(verstappen|hamilton|leclerc|norris|red bull racing|ferrari f1|mclaren f1|mercedes f1)\b/i.test(blob)
      );
    case 'chess':
      return (
        /\b(chess|fide|grandmaster|grandmasters|lichess|chess\.com)\b/i.test(blob) ||
        /\b(carlsen|nakamura|firouzja|ding liren|gukesh|praggnanandhaa)\b/i.test(blob) ||
        /\b(fide candidates|candidates tournament|tata steel chess|grand chess tour)\b/i.test(blob)
      );
    default:
      return true;
  }
}

/** Match article text to one of the four main Explore topics (used to strip them from “Others”). */
export function matchesMainTopic(text) {
  const t = (text || '').toLowerCase();
  const cricket =
    /\b(cricket|ipl|ashes|t20|odi|bbl|psl|wicket|test match|super over)\b/i.test(t);
  const football =
    /\b(soccer|nfl|ncaa football|fifa|uefa|premier league|champions league|la liga|bundesliga|serie a|mls|world cup)\b/i.test(
      t
    ) || /\bfootball\b/i.test(t);
  const f1 =
    /\b(formula\s*1|formula one|\bf1\b|grand prix|qualifying|constructor championship|paddock)\b/i.test(t);
  const chess = /\b(chess|fide|grandmaster|carlsen|nakamura|lichess)\b/i.test(t);
  return cricket || football || f1 || chess;
}

export function browseTopicOnGoogleNews(topicId) {
  const q = GOOGLE_BROWSE_QUERY[topicId] || GOOGLE_BROWSE_QUERY.others;
  return googleNewsSearchUrl(q.trim());
}

function isDirectImageUrl(u) {
  const s = typeof u === 'string' ? u.trim() : '';
  if (!s) return false;
  const path = s.split('?')[0].split('#')[0];
  return /\.(jpe?g|png|gif|webp)$/i.test(path);
}

function resolveRedditPostImage(post) {
  try {
    const src = post?.preview?.images?.[0]?.source?.url;
    if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
      return src.replace(/&amp;/g, '&').trim();
    }
  } catch {
    /* ignore */
  }
  const url = typeof post?.url === 'string' ? post.url.trim() : '';
  if (isDirectImageUrl(url)) return url;
  const thumbnail = typeof post?.thumbnail === 'string' ? post.thumbnail.trim() : '';
  if (/^https?:\/\//i.test(thumbnail)) return thumbnail;
  return null;
}

function redditPermalinkUrl(post) {
  const permalink = typeof post?.permalink === 'string' ? post.permalink.trim() : '';
  if (permalink) {
    return `https://www.reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`;
  }
  const u = typeof post?.url === 'string' ? post.url.trim() : '';
  return /^https?:\/\//i.test(u) ? u : '';
}

function redditPublishedAt(post) {
  const u = post?.created_utc;
  const n = typeof u === 'number' ? u : Number(u || 0);
  if (n > 0) return new Date(n * 1000).toISOString();
  return new Date().toISOString();
}

/**
 * @param {string[]} subs
 * @param {{ maxPerSub?: number, maxKeep?: number, minScore?: number, filterPost?: (post: object) => boolean }} [options]
 */
async function tryRedditHotRows(subs, options = {}) {
  const maxPerSub = typeof options.maxPerSub === 'number' ? options.maxPerSub : 40;
  const maxKeep = typeof options.maxKeep === 'number' ? options.maxKeep : 22;
  const minScore = typeof options.minScore === 'number' ? options.minScore : 15;
  const filterPost = typeof options.filterPost === 'function' ? options.filterPost : null;

  const seenTitles = new Set();
  const seenUrls = new Set();
  const picked = [];
  const normalizeScore = (s) => (typeof s === 'number' ? s : Number(s || 0));

  for (const sub of subs) {
    if (picked.length >= maxKeep) break;
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=${maxPerSub}&raw_json=1`;
    let children = [];
    try {
      const jr = await fetchJsonGet(url, { timeoutMs: 20000 });
      const listing = jr?.data?.data;
      const ch = listing?.children;
      children = Array.isArray(ch) ? ch : [];
    } catch {
      children = [];
    }

    for (const child of children) {
      if (picked.length >= maxKeep) break;
      const post = child?.data;
      if (!post || typeof post !== 'object') continue;
      if (filterPost && !filterPost(post)) continue;

      const title = typeof post.title === 'string' ? post.title.trim() : '';
      if (!title) continue;
      const titleKey = title.toLowerCase();
      if (seenTitles.has(titleKey)) continue;

      if (post.stickied === true) continue;
      if (String(post.author || '') === 'AutoModerator') continue;
      const score = normalizeScore(post.score);
      if (!score || score < minScore) continue;

      const link = redditPermalinkUrl(post);
      if (!/^https?:\/\//i.test(link)) continue;
      if (seenUrls.has(link)) continue;

      const thumbnail = typeof post.thumbnail === 'string' ? post.thumbnail.trim() : '';
      const thumb = /^https?:\/\//i.test(thumbnail) ? thumbnail : null;
      const image = resolveRedditPostImage(post);

      seenTitles.add(titleKey);
      seenUrls.add(link);
      picked.push({
        title,
        url: link,
        image,
        thumbnail: thumb,
        score,
        num_comments: Number(post.num_comments || 0),
        author: typeof post.author === 'string' && post.author.trim() ? post.author.trim() : 'unknown',
        source: `r/${sub}`,
        description: '',
        publishedAt: redditPublishedAt(post),
        sourceSiteUrl: `https://www.reddit.com/r/${encodeURIComponent(sub)}`,
        publisherUrl: '',
      });
    }
  }

  picked.sort(
    (a, b) =>
      Number(b.score || 0) - Number(a.score || 0) || Number(b.num_comments || 0) - Number(a.num_comments || 0)
  );
  return picked.slice(0, maxKeep);
}

export function buildFallbackRows(topicId, label) {
  const q = GOOGLE_BROWSE_QUERY[topicId] || GOOGLE_BROWSE_QUERY.others;
  const baseUrl = googleNewsSearchUrl(q.trim());
  const now = new Date().toISOString();
  return Array.from({ length: 6 }, (_, i) => ({
    title: `${label} update ${i + 1}`,
    source: 'News',
    url: baseUrl,
    image: null,
    description: `${label} roundup`,
    publishedAt: now,
    sourceSiteUrl: '',
    publisherUrl: '',
  }));
}

/** Google News RSS first — does not consume NewsAPI quota (free tier exhausts quickly). */
async function trySportsRowsFromGoogleRss(topicId) {
  const rssQ =
    topicId === 'cricket'
      ? 'cricket OR IPL OR T20 when:7d'
      : topicId === 'football'
        ? 'soccer OR MLS OR Premier League when:7d'
        : topicId === 'f1'
          ? 'Formula 1 OR F1 when:7d'
          : topicId === 'chess'
            ? 'chess OR FIDE when:7d'
            : 'sports when:7d';
  const rssItems = await fetchLiveFromGoogleRssByQuery(rssQ);
  if (topicId === 'others') {
    const filtered = (rssItems || []).filter((a) => {
      const blob = `${a.title} ${a.description || ''}`;
      return !matchesMainTopic(blob);
    });
    return filtered.length ? filtered.slice(0, 30) : [];
  }
  let picked = (rssItems || []).filter((a) => sportArticleMatchesTopic(topicId, a)).slice(0, 30);
  if (!picked.length) picked = (rssItems || []).slice(0, 30);
  else if (topicId === 'football' && picked.length < 6) {
    const urls = new Set(picked.map((p) => p.url).filter(Boolean));
    for (const a of rssItems || []) {
      if (picked.length >= 18) break;
      if (a?.url && !urls.has(a.url)) {
        urls.add(a.url);
        picked.push(a);
      }
    }
  }
  return picked;
}

function dedupeByTitleJaccard(enriched) {
  const normWords = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => w.length > 2);
  const jaccard = (a, b) => {
    const A = new Set(normWords(a));
    const B = new Set(normWords(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    const uni = A.size + B.size - inter;
    return uni ? inter / uni : 0;
  };
  const deduped = [];
  for (const it of enriched) {
    if (!it?.title) continue;
    const already = deduped.some((x) => jaccard(x.title, it.title) >= 0.62);
    if (!already) deduped.push(it);
  }
  return deduped;
}

/**
 * NewsAPI-only path (skipped when rate-limit cooldown — see `isNewsApiRateLimitedCooldown`).
 * @returns {Promise<object[]>}
 */
async function loadNewsApiSportsRows(topicId, config) {
  if (topicId === 'others') {
    const normalized = await fetchNewsApiTopHeadlinesNormalized({
      category: 'sports',
      language: 'en',
      pageSize: 100,
    });
    const filtered = (normalized || []).filter((a) => {
      const blob = `${a.title} ${a.description || ''}`;
      return !matchesMainTopic(blob);
    });
    return filtered.slice(0, 30);
  }
  if (!config.q) return [];

  let fetched = await fetchNewsApiEverythingNormalized({ q: config.q, pageSize: 100 });
  let onTopic = (fetched || []).filter((a) => sportArticleMatchesTopic(topicId, a));

  if (!onTopic.length) {
    const narrowQ =
      topicId === 'cricket'
        ? 'cricket OR IPL'
        : topicId === 'football'
          ? 'soccer OR MLS'
          : topicId === 'f1'
            ? 'Formula 1'
            : topicId === 'chess'
              ? 'chess OR FIDE'
              : null;
    if (narrowQ) {
      fetched = await fetchNewsApiEverythingNormalized({ q: narrowQ, pageSize: 60 });
      onTopic = (fetched || []).filter((a) => sportArticleMatchesTopic(topicId, a));
    }
  }
  let topHeadlinesLen = 0;
  if (!onTopic.length) {
    const qHead =
      topicId === 'cricket'
        ? 'cricket'
        : topicId === 'football'
          ? 'soccer'
          : topicId === 'f1'
            ? 'F1'
            : topicId === 'chess'
              ? 'chess'
              : '';
    const thSports = await fetchNewsApiTopHeadlinesNormalized({
      category: 'sports',
      language: 'en',
      pageSize: 100,
      ...(qHead ? { q: qHead } : {}),
    });
    topHeadlinesLen = (thSports || []).length;
    onTopic = (thSports || []).filter((a) => sportArticleMatchesTopic(topicId, a));
    if (!onTopic.length && topicId === 'cricket') {
      const thIn = await fetchNewsApiTopHeadlinesNormalized({
        country: 'in',
        language: 'en',
        pageSize: 50,
        q: 'cricket',
      });
      topHeadlinesLen += (thIn || []).length;
      onTopic = (thIn || []).filter((a) => sportArticleMatchesTopic(topicId, a));
      if (!onTopic.length && (thIn || []).length) onTopic = thIn.slice(0, 30);
    }
    if (!onTopic.length && (thSports || []).length) {
      onTopic = thSports.slice(0, 30);
    }
  }

  return onTopic.slice(0, 30);
}

function mergeSportsApiAndRss(apiRows, rssRows, maxKeep = 36) {
  const seen = new Set();
  const out = [];
  for (const r of apiRows || []) {
    const u = (r?.url || '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(r);
  }
  for (const r of rssRows || []) {
    const u = (r?.url || '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(r);
    if (out.length >= maxKeep) break;
  }
  return out;
}

/**
 * NewsAPI + RSS merge + OG images + title de-dupe.
 * @param {string} topicId
 * @param {{ rssOnlyPrefetch?: boolean }} [options] — If true, skip NewsAPI (RSS + light enrich only). Use for background prefetch so one screen load does not fire 5× `everything` calls.
 * @returns {{ items: object[], error: string, allowRewrite: boolean }}
 */
export async function fetchSportsTopicRawItems(topicId, options = {}) {
  const rssOnlyPrefetch = options.rssOnlyPrefetch === true;
  const config = TOPIC_META[topicId];
  if (!config) return { items: [], error: '', allowRewrite: false };

  const title = config.label;

  // Cricket: Reddit-only (no NewsAPI / RSS fallback).
  if (topicId === 'cricket') {
    const redditRows = await tryRedditHotRows(REDDIT_SPORTS_SUBS.cricket, {
      maxPerSub: 50,
      maxKeep: 18,
      minScore: 18,
    });
    if (redditRows.length) {
      return { items: redditRows, error: '', allowRewrite: false };
    }
    return {
      items: buildFallbackRows(topicId, title),
      error: 'Cricket posts are unavailable from Reddit right now. Try again shortly.',
      allowRewrite: false,
    };
  }

  // Football: listed subreddits first; News/RSS only if Reddit yields nothing.
  if (topicId === 'football') {
    const redditRows = await tryRedditHotRows(REDDIT_SPORTS_SUBS.football, {
      maxPerSub: 40,
      maxKeep: 22,
      minScore: 16,
    });
    if (redditRows.length) {
      return { items: redditRows, error: '', allowRewrite: false };
    }
  }

  if (topicId === 'f1') {
    const redditRows = await tryRedditHotRows(REDDIT_SPORTS_SUBS.f1, {
      maxPerSub: 40,
      maxKeep: 22,
      minScore: 14,
    });
    if (redditRows.length) {
      return { items: redditRows, error: '', allowRewrite: false };
    }
  }

  if (topicId === 'chess') {
    const redditRows = await tryRedditHotRows(REDDIT_SPORTS_SUBS.chess, {
      maxPerSub: 40,
      maxKeep: 22,
      minScore: 12,
    });
    if (redditRows.length) {
      return { items: redditRows, error: '', allowRewrite: false };
    }
  }

  // Other sports: Reddit first; drop posts that match cricket/football/F1/chess (same as news filter).
  if (topicId === 'others') {
    const redditRows = await tryRedditHotRows(REDDIT_SPORTS_SUBS.others, {
      maxPerSub: 45,
      maxKeep: 28,
      minScore: 14,
      filterPost: (post) => {
        const blob = `${post?.title || ''} ${typeof post?.selftext === 'string' ? post.selftext : ''}`;
        return !matchesMainTopic(blob);
      },
    });
    if (redditRows.length) {
      return { items: redditRows, error: '', allowRewrite: false };
    }
  }

  if (!canFetchLiveNews()) {
    return {
      items: buildFallbackRows(topicId, title),
      error:
        'Backend NewsAPI is unavailable. Set NEWSAPI_KEY on the server (Firebase Functions: `newsApi`). Showing browse links only.',
      allowRewrite: false,
    };
  }

  const cooldown = isNewsApiRateLimitedCooldown();
  const rssPromise = trySportsRowsFromGoogleRss(topicId);
  const apiPromise =
    rssOnlyPrefetch || cooldown ? Promise.resolve([]) : loadNewsApiSportsRows(topicId, config);
  const [rssRows, apiRows] = await Promise.all([rssPromise, apiPromise]);

  let rows = mergeSportsApiAndRss(apiRows, rssRows, 40);
  const apiLen = (apiRows || []).length;
  const rssLen = (rssRows || []).length;

  if (!rows.length) {
    const picked = await trySportsRowsFromGoogleRss(topicId);
    if (picked.length) {
      rows = picked;
    }
  }

  if (!rows.length) {
    return {
      items: buildFallbackRows(topicId, title),
      error:
        'News returned no articles. Web: set REACT_APP_NEWSAPI in .env and restart the dev server. APK: run npm run build with that variable set, then npx cap sync android and reinstall. Or deploy Firebase (NEWSAPI_KEY on function newsApi and hosting /api/news). Check NewsAPI plan limits.',
      allowRewrite: false,
    };
  }

  rows = rows.slice(0, 30);

  // Prefetch: skip OG network work — opening the topic page does full enrich.
  const enriched = await enrichNewsItemsWithOgImages(rows, {
    enableOgFallback: !rssOnlyPrefetch,
    maxResolve: rssOnlyPrefetch ? 0 : 10,
    concurrency: rssOnlyPrefetch ? 1 : 2,
  });
  const deduped = dedupeByTitleJaccard(enriched);
  const rssOnlyMerged = apiLen === 0 && rssLen > 0;
  return {
    items: deduped.length ? deduped : enriched,
    error: '',
    allowRewrite: !rssOnlyMerged,
  };
}

/**
 * OpenAI headline pass (same rules as previous in-component implementation).
 * @param {string} topicId
 * @param {object[]} dedupedItems
 */
export async function applyHeadlineRewritesToSportsItems(topicId, dedupedItems) {
  if (!dedupedItems?.length) return dedupedItems;

  const extractMustMention = (titleText) => {
    const t = String(titleText || '');
    const out = [];
    const push = (w) => {
      const s = String(w || '').trim();
      if (!s) return;
      if (out.includes(s)) return;
      out.push(s);
    };
    for (const m of t.matchAll(/\b[A-Z]{2,}\b/g)) push(m[0]);
    for (const m of t.matchAll(/\b[A-Z][a-z]{2,}\b/g)) push(m[0]);
    for (const m of t.matchAll(/\$?\d[\d.,]*\s?(?:B|BN|M|million|billion|crore)?\b/g)) push(m[0]);
    const generic = new Set([
      'The',
      'A',
      'An',
      'And',
      'For',
      'With',
      'From',
      'Into',
      'Over',
      'After',
      'More',
      'New',
      'Team',
      'Teams',
      'Sold',
      'Buy',
      'Buys',
      'Deal',
    ]);
    return out.filter((x) => !generic.has(x)).slice(0, 6);
  };

  const extractFactTokens = (titleText, descriptionText) => {
    const t = `${String(titleText || '')} ${String(descriptionText || '')}`;
    const out = [];
    const push = (w) => {
      const s = String(w || '').trim();
      if (!s) return;
      if (out.includes(s)) return;
      out.push(s);
    };
    for (const m of t.matchAll(
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gi
    ))
      push(m[0]);
    for (const m of t.matchAll(
      /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gi
    ))
      push(m[0]);
    for (const m of t.matchAll(/\b(?:₹|\$|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|b|crore|lakh|million|billion)?\b/gi))
      push(m[0]);
    for (const m of t.matchAll(/\b\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|b|crore|lakh|million|billion|%)\b/gi))
      push(m[0]);
    for (const m of t.matchAll(/\b\d{1,3}\s?[-–]\s?\d{1,3}\b/g)) push(m[0]);
    for (const m of t.matchAll(/\b\d{1,3}\/\d{1,2}\b/g)) push(m[0]);
    return out.slice(0, 6);
  };

  const payload = dedupedItems.map((x) => ({
    title: x.title,
    url: x.url,
    description: x.description || '',
    mustMention: extractMustMention(x.title),
    factTokens: extractFactTokens(x.title, x.description || ''),
  }));

  const headings1 = await chatService.rewriteNewsHeadlines(payload, {
    maxHeadlines: Math.min(30, payload.length),
  });

  const normalizedKey = (h) =>
    String(h || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const used = new Set();
  const conflicts = [];
  const finalHeadings = headings1.map((h, idx) => {
    const cleaned = String(h || '').trim();
    const key = normalizedKey(cleaned);
    const must = Array.isArray(payload[idx]?.mustMention) ? payload[idx].mustMention : [];
    const hasMust =
      !must.length || must.some((tok) => cleaned.toLowerCase().includes(String(tok).toLowerCase()));
    const facts = Array.isArray(payload[idx]?.factTokens) ? payload[idx].factTokens : [];
    const hasFact =
      !facts.length || facts.some((tok) => cleaned.toLowerCase().includes(String(tok).toLowerCase()));
    const bannedTemplate = /\b(all you need to know|everything you need to know|here(?:’|')?s what we know|explained)\b/i.test(
      cleaned
    );
    if (!cleaned || !key || used.has(key) || !hasMust || !hasFact || bannedTemplate) {
      conflicts.push(idx);
      return '';
    }
    used.add(key);
    return cleaned;
  });

  if (conflicts.length) {
    const avoidHeadings = Array.from(used).slice(0, 60);
    const conflictItems = conflicts.map((idx) => payload[idx]);
    const headings2 = await chatService.rewriteNewsHeadlines(conflictItems, {
      maxHeadlines: conflictItems.length,
      avoidHeadings,
    });
    for (let i = 0; i < conflicts.length; i++) {
      const idx = conflicts[i];
      const candidate = String(headings2?.[i] || '').trim();
      const key = normalizedKey(candidate);
      const must = Array.isArray(payload[idx]?.mustMention) ? payload[idx].mustMention : [];
      const hasMust =
        !must.length || must.some((tok) => candidate.toLowerCase().includes(String(tok).toLowerCase()));
      const facts = Array.isArray(payload[idx]?.factTokens) ? payload[idx].factTokens : [];
      const hasFact =
        !facts.length || facts.some((tok) => candidate.toLowerCase().includes(String(tok).toLowerCase()));
      const bannedTemplate = /\b(all you need to know|everything you need to know|here(?:’|')?s what we know|explained)\b/i.test(
        candidate
      );
      if (candidate && key && !used.has(key) && hasMust && hasFact && !bannedTemplate) {
        used.add(key);
        finalHeadings[idx] = candidate;
      } else {
        finalHeadings[idx] = payload[idx].title;
      }
    }
  }

  return dedupedItems.map((x, idx) => ({ ...x, title: finalHeadings[idx] || x.title }));
}
