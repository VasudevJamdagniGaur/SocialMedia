import { useEffect, useRef } from 'react';
import { logUserNewsActivity } from '../services/hubNewsService';

/**
 * When a hub trending card opens Share Suggestions, log dwell time (open → leave page)
 * and persist to userActivity + aggregated behavior on users/{uid}.
 *
 * Pass meta from navigation state: { category, url, openedAt }.
 */
export function useLogHubNewsActivityOnUnmount(userId, meta) {
  const loggedRef = useRef(false);
  useEffect(() => {
    loggedRef.current = false;
  }, [meta?.openedAt, meta?.url]);

  useEffect(() => {
    if (!userId || !meta?.category || typeof meta.openedAt !== 'number') return undefined;
    return () => {
      if (loggedRef.current) return;
      loggedRef.current = true;
      const timeSpent = Math.max(0, Math.round((Date.now() - meta.openedAt) / 1000));
      logUserNewsActivity(userId, {
        category: meta.category,
        url: meta.url,
        timeSpent,
        timestamp: Date.now(),
      }).catch(() => {});
    };
  }, [userId, meta?.category, meta?.url, meta?.openedAt]);
}
