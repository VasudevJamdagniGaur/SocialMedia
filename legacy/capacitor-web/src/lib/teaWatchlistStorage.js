const STORAGE_KEY = 'deite_tea_watchlist_v1';

/**
 * @returns {{ id: string, title: string, url: string, postUrl: string, thumbnail: string, author: string, savedAt: string }[]}
 */
export function getTeaWatchlist() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x === 'object') : [];
  } catch {
    return [];
  }
}

/** @param {ReturnType<typeof getTeaWatchlist>} items */
export function setTeaWatchlist(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode */
  }
}

/** @param {Record<string, unknown>} item Raw tea carousel / feed item */
export function normalizeTeaItemForWatchlist(item) {
  return {
    id: String(item?.id ?? ''),
    title: typeof item?.title === 'string' ? item.title : '',
    url: typeof item?.url === 'string' ? item.url : '',
    postUrl: typeof item?.postUrl === 'string' ? item.postUrl : '',
    thumbnail: typeof item?.thumbnail === 'string' ? item.thumbnail : '',
    author: typeof item?.author === 'string' ? item.author : '',
    savedAt: new Date().toISOString(),
    source: 'tea',
  };
}

/**
 * Toggle item in watchlist by Reddit post id. Returns the new list.
 * @param {Record<string, unknown>} item
 */
export function toggleTeaWatchlistItem(item) {
  const id = String(item?.id ?? '');
  if (!id) return getTeaWatchlist();
  const list = getTeaWatchlist();
  const idx = list.findIndex((x) => String(x.id) === id);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    const row = normalizeTeaItemForWatchlist(item);
    if (!row.url) return list;
    list.unshift(row);
  }
  setTeaWatchlist(list);
  return list;
}

export function removeTeaWatchlistById(postId) {
  const id = String(postId);
  const list = getTeaWatchlist().filter((x) => String(x.id) !== id);
  setTeaWatchlist(list);
  return list;
}

export function isTeaPostWatchlisted(postId) {
  const id = String(postId);
  return getTeaWatchlist().some((x) => String(x.id) === id);
}
