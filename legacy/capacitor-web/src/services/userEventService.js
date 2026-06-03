import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { db } from '../firebase/config';
 
const ALLOWED_EVENT_TYPES = new Set(['impression', 'view', 'scroll', 'like', 'comment', 'share', 'save']);
 
function getDeviceType() {
  try {
    if (Capacitor?.isNativePlatform?.()) {
      const platform = (Capacitor.getPlatform?.() || '').toLowerCase();
      if (platform === 'ios' || platform === 'android') return platform;
      return 'android';
    }
  } catch (_) {}
  return 'web';
}
 
function unixSecondsNow() {
  return Math.floor(Date.now() / 1000);
}
 
function createSessionId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch (_) {}
  return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
 
/**
 * User interaction event tracking for feed recommendation signals.
 * - Non-blocking: events are queued and flushed in batches.
 * - Impression dedupe: no duplicate impressions for same post in same session.
 */
class UserEventService {
  constructor() {
    this._sessionId = null;
    this._deviceType = getDeviceType();
    this._queue = [];
    this._flushTimer = null;
    this._impressionDedup = new Set(); // `${sessionId}:${postId}`
    this._maxBatch = 25;
    this._flushIntervalMs = 1200;
  }
 
  startSession() {
    this._sessionId = createSessionId();
    this._impressionDedup.clear();
    return this._sessionId;
  }
 
  getSessionId() {
    return this._sessionId || this.startSession();
  }
 
  /**
   * Enqueue an event. Flushes asynchronously.
   * @param {{ user_id: string, post_id: string, event_type: string, dwell_time_ms?: number|null, position_in_feed?: number|null }} payload
   */
  logEvent(payload) {
    const user_id = (payload?.user_id || '').trim();
    const post_id = (payload?.post_id || '').trim();
    const event_type = (payload?.event_type || '').trim();
 
    if (!user_id || !post_id) return;
    if (!ALLOWED_EVENT_TYPES.has(event_type)) return;
 
    const session_id = this.getSessionId();
 
    // Deduplicate impressions within session
    if (event_type === 'impression') {
      const key = `${session_id}:${post_id}`;
      if (this._impressionDedup.has(key)) return;
      this._impressionDedup.add(key);
    }
 
    const dwell_time_ms =
      event_type === 'view'
        ? Math.max(0, Number(payload?.dwell_time_ms ?? 0))
        : null;
 
    const position_in_feed =
      payload?.position_in_feed == null ? null : Math.max(1, Number(payload.position_in_feed));
 
    const evt = {
      user_id,
      post_id,
      event_type,
      timestamp: unixSecondsNow(),
      dwell_time_ms,
      session_id,
      device_type: this._deviceType,
      position_in_feed
    };
 
    this._queue.push(evt);
    this._scheduleFlush();
  }
 
  _scheduleFlush() {
    if (this._queue.length >= this._maxBatch) {
      this.flush();
      return;
    }
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, this._flushIntervalMs);
  }
 
  async flush() {
    if (!this._queue.length) return;
    const events = this._queue.splice(0, this._maxBatch);
 
    // Non-blocking fire-and-forget
    Promise.resolve().then(async () => {
      try {
        const batch = writeBatch(db);
        const colRef = collection(db, 'user_events');
        for (const e of events) {
          const ref = doc(colRef);
          batch.set(ref, { id: ref.id, ...e, createdAt: serverTimestamp() });
        }
        await batch.commit();
      } catch (err) {
        // If commit fails, don't spam; drop events to avoid UI impact.
        console.warn('[user_events] flush failed:', err?.message || err);
      }
    });
  }
}
 
const userEventService = new UserEventService();
 
export { userEventService };
export const USER_EVENT_SCHEMA = {
  collection: 'user_events',
  fields: [
    'id',
    'user_id',
    'post_id',
    'event_type',
    'timestamp',
    'dwell_time_ms',
    'session_id',
    'device_type',
    'position_in_feed'
  ],
  allowed_event_type_values: [...ALLOWED_EVENT_TYPES]
};
 
