const __NEWS_IMAGE_CACHE_KEY = 'deite_news_image_cache_v1';
const __NEWS_IMAGE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function safeReadJsonFromLocalStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeWriteJsonToLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode */
  }
}

function normalizeUrlKey(url) {
  return typeof url === 'string' ? url.trim() : '';
}

function readCache() {
  if (typeof localStorage === 'undefined') return {};
  const j = safeReadJsonFromLocalStorage(__NEWS_IMAGE_CACHE_KEY);
  return j && typeof j === 'object' ? j : {};
}

function writeCache(next) {
  if (typeof localStorage === 'undefined') return;
  if (!next || typeof next !== 'object') return;
  safeWriteJsonToLocalStorage(__NEWS_IMAGE_CACHE_KEY, next);
}

/**
 * @param {string} url
 * @returns {string|null}
 */
export function getCachedNewsImageForUrl(url) {
  const key = normalizeUrlKey(url);
  if (!key) return null;
  const cache = readCache();
  const entry = cache?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const ts = typeof entry.ts === 'number' ? entry.ts : 0;
  if (!ts || Date.now() - ts > __NEWS_IMAGE_TTL_MS) return null;
  const imageDataUrl = typeof entry.imageDataUrl === 'string' ? entry.imageDataUrl : '';
  if (!imageDataUrl.startsWith('data:image')) return null;
  return imageDataUrl;
}

/**
 * @param {string} url
 * @param {string} imageDataUrl
 */
export function setCachedNewsImageForUrl(url, imageDataUrl) {
  const key = normalizeUrlKey(url);
  const img = typeof imageDataUrl === 'string' ? imageDataUrl.trim() : '';
  if (!key || !img.startsWith('data:image')) return;
  const cache = readCache();
  cache[key] = { ts: Date.now(), imageDataUrl: img };
  writeCache(cache);
}

