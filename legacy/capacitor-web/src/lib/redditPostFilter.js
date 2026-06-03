/**
 * Reddit listing `data` helpers — filter sticky/meta/mod posts and low-signal threads.
 * Works with raw post objects from `hot.json` → `data.children[].data`.
 */

/** Matched case-insensitively against the post title only. */
export const DEFAULT_EXCLUDED_TITLE_KEYWORDS = [
  'subreddit',
  'moderator',
  'mods',
  'rules',
  'banned',
  'removed',
  'fanclub',
  'announcement',
  'meta',
  'policy',
];

/** Example topic keywords for entertainment / Bollywood-style feeds — pass your own per hub. */
export const BOLLYWOOD_TEA_TOPIC_KEYWORDS = [
  'bollywood',
  'movie',
  'film',
  'actor',
  'actress',
  'box office',
  'trailer',
  'release',
];

function normalizeUps(post) {
  if (typeof post.ups === 'number' && !Number.isNaN(post.ups)) return post.ups;
  if (typeof post.score === 'number' && !Number.isNaN(post.score)) return post.score;
  return 0;
}

/**
 * @param {string} title
 * @param {string[]} [excludedKeywords]
 */
export function titleHasExcludedKeyword(title, excludedKeywords = DEFAULT_EXCLUDED_TITLE_KEYWORDS) {
  const t = String(title || '').toLowerCase();
  return excludedKeywords.some((kw) => t.includes(String(kw).toLowerCase()));
}

/**
 * Structural / moderation / engagement checks (not topic keywords).
 * @param {object} post - Reddit `data` object
 * @param {{ excludedTitleKeywords?: string[] }} [options]
 */
export function isValidPost(post, options = {}) {
  if (!post || typeof post !== 'object') return false;
  if (post.stickied === true) return false;

  const title = typeof post.title === 'string' ? post.title : '';
  const excluded = options.excludedTitleKeywords ?? DEFAULT_EXCLUDED_TITLE_KEYWORDS;
  if (titleHasExcludedKeyword(title, excluded)) return false;

  if (normalizeUps(post) < 10) return false;

  const selftext = String(post.selftext ?? '').trim();
  const isSelf = post.is_self === true;
  // Link posts often have empty selftext; only enforce minimum body on text threads.
  if (isSelf && selftext.length < 20) return false;

  return true;
}

/**
 * @param {object} post - Reddit `data` object
 * @param {string[]} topicKeywords - e.g. sports or tech terms for another hub
 */
export function isRelevantPost(post, topicKeywords) {
  if (!Array.isArray(topicKeywords) || topicKeywords.length === 0) return false;
  const title = String(post.title ?? '').toLowerCase();
  const body = String(post.selftext ?? '').toLowerCase();
  const haystack = `${title} ${body}`;
  return topicKeywords.some((kw) => haystack.includes(String(kw).toLowerCase()));
}

/**
 * @param {object[]} posts - Reddit `data` objects (not full `{ kind, data }` children)
 * @param {string[]} [topicKeywords] - defaults to {@link BOLLYWOOD_TEA_TOPIC_KEYWORDS}
 * @param {{ excludedTitleKeywords?: string[] }} [options] - forwarded to {@link isValidPost}
 * @returns {object[]}
 */
export function filterPosts(posts, topicKeywords = BOLLYWOOD_TEA_TOPIC_KEYWORDS, options = {}) {
  if (!Array.isArray(posts)) return [];
  const kw = Array.isArray(topicKeywords) ? topicKeywords : [];
  return posts.filter((p) => isValidPost(p, options) && isRelevantPost(p, kw));
}

/*
  Usage:

  const children = json?.data?.children ?? [];
  const rawPosts = children.map((c) => c?.data).filter(Boolean);
  const filteredPosts = filterPosts(rawPosts);
  // Dynamic topic (e.g. another subreddit / hub):
  const filteredPosts = filterPosts(rawPosts, ['cricket', 'ipl', 'batsman', 'wicket', 'test match']);
*/
