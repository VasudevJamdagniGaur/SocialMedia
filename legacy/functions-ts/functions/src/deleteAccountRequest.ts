import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

/** Practical email check — not full RFC 5322; sufficient for Play compliance intake. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t || t.length > 320) return null;
  if (!EMAIL_RE.test(t)) return null;
  return t;
}

function parseBody(req: { body?: unknown }): Record<string, unknown> | null {
  const body = req.body;
  if (body == null) return {};
  if (typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * POST JSON { "email": string } — stores a pending account deletion request for manual processing.
 * CORS enabled for browser form on Firebase Hosting.
 */
export const deleteAccountRequest = onRequest({ cors: true }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const parsed = parseBody(req);
  if (parsed === null) {
    res.status(400).json({ success: false, error: 'Invalid JSON body' });
    return;
  }

  const email = normalizeEmail(parsed.email);
  if (!email) {
    res.status(400).json({ success: false, error: 'A valid email address is required' });
    return;
  }

  try {
    const db = admin.firestore();
    await db.collection('deleteRequests').add({
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
    });

    logger.info('[deleteAccountRequest] pending request stored', {
      emailHint: `${email.slice(0, 2)}***@${email.split('@')[1] || '?'}`,
    });

    res.status(200).json({ success: true, message: 'Deletion request submitted' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[deleteAccountRequest] firestore error', { message: msg });
    res.status(500).json({
      success: false,
      error: 'Could not submit your request. Please try again later.',
    });
  }
});
