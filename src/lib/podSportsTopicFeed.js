import chatService from '../services/chatService';
import {
  googleNewsSearchUrl,
  canFetchLiveNews,
  fetchNewsApiEverythingNormalized,
  fetchNewsApiTopHeadlinesNormalized,
  enrichNewsItemsWithOgImages,
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
 * NewsAPI + OG images + title de-dupe. No headline rewrite (cheap to prefetch).
 * @returns {{ items: object[], error: string }}
 */
export async function fetchSportsTopicRawItems(topicId) {
  const config = TOPIC_META[topicId];
  if (!config) return { items: [], error: '', allowRewrite: false };

  const title = config.label;
  if (!canFetchLiveNews()) {
    return {
      items: buildFallbackRows(topicId, title),
      error:
        'Backend NewsAPI is unavailable. Set NEWSAPI_KEY on the server (Firebase Functions: `newsApi`). Showing browse links only.',
      allowRewrite: false,
    };
  }

  let rows = null;

  if (topicId === 'others') {
    const normalized = await fetchNewsApiTopHeadlinesNormalized({
      category: 'sports',
      language: 'en',
      pageSize: 100,
    });
    const filtered = normalized.filter((a) => {
      const blob = `${a.title} ${a.description || ''}`;
      return !matchesMainTopic(blob);
    });
    if (filtered.length) rows = filtered.slice(0, 30);
  } else if (config.q) {
    const fetched = await fetchNewsApiEverythingNormalized({ q: config.q, pageSize: 100 });
    const onTopic = (fetched || []).filter((a) => sportArticleMatchesTopic(topicId, a));
    rows = onTopic.slice(0, 30);
  }

  if (!rows?.length) {
    return {
      items: buildFallbackRows(topicId, title),
      error:
        'Backend NewsAPI returned no articles. Make sure your backend endpoint is reachable (Firebase Hosting rewrites OR direct function URL) and that `NEWSAPI_KEY` is set on Firebase Functions (`newsApi`). Also verify NewsAPI query/plan limits.',
      allowRewrite: false,
    };
  }

  const enriched = await enrichNewsItemsWithOgImages(rows, { enableOgFallback: true });
  const deduped = dedupeByTitleJaccard(enriched);
  return {
    items: deduped.length ? deduped : enriched,
    error: '',
    allowRewrite: true,
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
