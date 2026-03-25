import * as path from 'path';
import { config as loadEnv } from 'dotenv';

// Load functions/.env so LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are available (local emulator).
// In production, set these in Firebase Console → Project → Functions → Environment variables.
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import {
  getLinkedInConfig,
  exchangeCodeForToken,
  getLinkedInPersonUrn,
  storeLinkedInToken,
  getLinkedInAccessToken,
  registerImageUpload,
  uploadImageToLinkedIn,
  waitForLinkedInAssetAvailable,
  createLinkedInUgcPost,
  getLinkedInPostAnalytics,
} from './linkedin';

admin.initializeApp();

type CommunityPost = {
  text_content?: string;
  image_url?: string;
  content?: string; // existing app uses `content`
  image?: string; // existing app uses `image`
  embedding_vector?: number[];
};

function getEmbeddingServiceConfig() {
  const url = (process.env.EMBEDDING_SERVICE_URL || '').trim();
  const apiKey = (process.env.EMBEDDING_SERVICE_API_KEY || '').trim();
  return { url, apiKey };
}

async function fetchEmbedding256(
  text: string,
  imageUrl: string,
  postId: string,
  apiUrl: string,
  apiKey: string
): Promise<number[] | null> {
  if (!apiUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        post_id: postId,
        text_content: text,
        image_url: imageUrl
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      logger.warn('[embedding] service not ok', { status: res.status, body: txt?.slice(0, 300) });
      return null;
    }
    const data = (await res.json()) as { embedding_vector?: number[] };
    const v = data?.embedding_vector;
    if (!Array.isArray(v) || v.length !== 256) return null;
    // basic sanity
    if (v.some((x) => typeof x !== 'number' || Number.isNaN(x))) return null;
    return v;
  } catch (e: any) {
    logger.warn('[embedding] fetch failed', { message: e?.message || String(e) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Firestore trigger: auto-generate embeddings for every new post.
 * Collection: communityPosts/{postId}
 *
 * Writes: embedding_vector (256 dims) back to the document.
 *
 * Idempotent: if embedding_vector already exists, skip.
 */
export const generatePostEmbedding = onDocumentCreated('communityPosts/{postId}', async (event) => {
  const snap = event.data;
  const postId = event.params.postId as string;
  if (!snap) return;

  const post = snap.data() as CommunityPost;
  if (!post) return;

  // Idempotency guard
  if (Array.isArray(post.embedding_vector) && post.embedding_vector.length === 256) {
    return;
  }

  const text = (post.text_content || post.content || '').trim();
  const imageUrl = (post.image_url || post.image || '').trim();

  const { url, apiKey } = getEmbeddingServiceConfig();
  if (!url) {
    logger.warn('[embedding] EMBEDDING_SERVICE_URL not set; skipping', { postId });
    return;
  }

  const embedding = await fetchEmbedding256(text, imageUrl, postId, url, apiKey);
  if (!embedding) {
    logger.warn('[embedding] could not generate embedding', { postId });
    return;
  }

  await snap.ref.set(
    {
      embedding_vector: embedding,
      embedding_updated_at: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
});

// ---------- LinkedIn OAuth & Share (backend only; client secret never exposed) ----------

/**
 * POST /api/linkedin/exchange — exchange auth code for token, store in Firestore.
 * Body: { code: string, state?: string } (state = Firebase uid to associate token).
 */
async function handleLinkedInExchange(req: import('firebase-functions/v2/https').Request, res: { set: (k: string, v: string) => void; status: (n: number) => { json: (o: object) => void; end: () => void }; json: (o: object) => void }): Promise<void> {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { code, state } = (req.body || {}) as { code?: string; state?: string };
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing or invalid code' });
      return;
    }
    const uid = (state && typeof state === 'string') ? state.trim() : null;
    if (!uid) {
      res.status(400).json({ error: 'Missing state (Firebase uid)' });
      return;
    }

    const tokenResult = await exchangeCodeForToken(code);
    await storeLinkedInToken(uid, tokenResult.access_token, tokenResult.expires_in);
    const personUrn = await getLinkedInPersonUrn(tokenResult.access_token);
    const db = admin.firestore();
    await db.collection('users').doc(uid).set(
      {
        linkedin: {
          accessToken: tokenResult.access_token,
          expiresAt: Date.now() + tokenResult.expires_in * 1000,
          linkedinPersonUrn: personUrn,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    res.status(200).json({ success: true, linkedinConnected: true });
  } catch (e: any) {
    logger.warn('[linkedin] exchange error', { message: e?.message });
    res.status(500).json({ error: e?.message || 'Token exchange failed' });
  }
}

/**
 * POST /api/linkedin/share — create LinkedIn UGC post with image; optionally update Firestore post doc.
 * Body: { userId: string, caption: string, imageUrl: string, postId?: string }.
 *
 * Implements LinkedIn's 3‑step image upload flow:
 * 1) registerUpload → get upload URL + asset URN
 * 2) PUT image bytes to upload URL
 * 3) POST ugcPosts with the asset URN attached
 */
async function handleLinkedInShare(
  req: import('firebase-functions/v2/https').Request,
  res: {
    set: (k: string, v: string) => void;
    status: (n: number) => { json: (o: object) => void; end: () => void };
    json: (o: object) => void;
  }
): Promise<void> {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const db = admin.firestore();

  try {
    const { userId, caption, imageUrl, postId } = (req.body || {}) as {
      userId?: string;
      caption?: string;
      imageUrl?: string;
      postId?: string;
    };

    // Step 0: validate payload
    if (!userId || !caption || !imageUrl) {
      res.status(400).json({ error: 'Missing userId, caption, or imageUrl' });
      return;
    }

    // Step 1: get LinkedIn accessToken + person URN from Firestore
    let accessToken: string | null = null;
    let personUrn: string | undefined;
    try {
      accessToken = await getLinkedInAccessToken(userId);
      const userDoc = await db.collection('users').doc(userId).get();
      const linkedin = userDoc.data()?.linkedin as
        | { linkedinPersonUrn?: string; personId?: string }
        | undefined;
      personUrn = linkedin?.linkedinPersonUrn;
      if (!personUrn && linkedin?.personId) {
        personUrn = `urn:li:person:${linkedin.personId}`;
      }
    } catch (e) {
      logger.warn('[linkedin] share step 1 (load credentials) failed', { message: (e as any)?.message, userId });
      res.status(500).json({ error: 'Failed to load LinkedIn credentials for user' });
      return;
    }

    if (!accessToken) {
      res.status(401).json({ error: 'LinkedIn not connected or token expired' });
      return;
    }
    if (!personUrn) {
      res.status(400).json({ error: 'LinkedIn person URN not found; reconnect LinkedIn' });
      return;
    }

    // Step 2: fetch image bytes from imageUrl
    let imageBuffer: Buffer;
    let contentType: string;
    try {
      const imageRes = await fetch(imageUrl, { method: 'GET' });
      if (!imageRes.ok) {
        const text = await imageRes.text().catch(() => '');
        logger.warn('[linkedin] share step 2 (fetch image) failed', {
          status: imageRes.status,
          body: text.slice(0, 200),
        });
        res.status(500).json({ error: 'Failed to fetch image from URL' });
        return;
      }
      const arr = await imageRes.arrayBuffer();
      imageBuffer = Buffer.from(arr);
      contentType = imageRes.headers.get('content-type') || 'image/jpeg';
    } catch (e) {
      logger.warn('[linkedin] share step 2 (download image) error', { message: (e as any)?.message });
      res.status(500).json({ error: 'Error downloading image' });
      return;
    }

    // Step 3.1: registerUpload with LinkedIn
    let uploadUrl: string;
    let assetUrn: string;
    try {
      const { uploadUrl: u, asset } = await registerImageUpload(accessToken, personUrn, imageBuffer.length);
      uploadUrl = u;
      assetUrn = asset;
    } catch (e) {
      logger.warn('[linkedin] share step 3.1 (registerUpload) failed', { message: (e as any)?.message });
      res.status(500).json({ error: 'LinkedIn registerUpload failed' });
      return;
    }

    // Step 3.2: upload image bytes
    try {
      await uploadImageToLinkedIn(accessToken, uploadUrl, imageBuffer, contentType);
    } catch (e) {
      logger.warn('[linkedin] share step 3.2 (image upload) failed', { message: (e as any)?.message });
      res.status(500).json({ error: 'LinkedIn image upload failed' });
      return;
    }

    // Step 3.2b: wait for asset to be AVAILABLE so the post actually appears on LinkedIn.
    // If the status check fails (e.g. 403 on GET asset), wait 5s and proceed anyway.
    try {
      await waitForLinkedInAssetAvailable(accessToken, assetUrn, { maxWaitMs: 30_000, pollIntervalMs: 2_000 });
      logger.info('[linkedin] share step 3.2b: asset AVAILABLE');
    } catch (e) {
      const msg = (e as any)?.message ?? '';
      logger.warn('[linkedin] share step 3.2b (wait for asset) failed', { message: msg });
      // Fallback: wait 5s then create post anyway (GET asset may return 403 for some tokens)
      logger.info('[linkedin] share step 3.2b: fallback 5s delay before create');
      await new Promise((r) => setTimeout(r, 5_000));
    }

    // Step 3.3: create UGC post
    let linkedinPostId: string;
    try {
      linkedinPostId = await createLinkedInUgcPost(accessToken, personUrn, caption, assetUrn);
      logger.info('[linkedin] share step 3.3: post created', { linkedinPostId });
    } catch (e) {
      logger.warn('[linkedin] share step 3.3 (ugcPosts) failed', { message: (e as any)?.message });
      res.status(500).json({ error: 'LinkedIn post creation failed' });
      return;
    }

    // Optional: update your posts collection
    if (postId) {
      try {
        await db.collection('posts').doc(postId).set(
          {
            platform: 'linkedin',
            linkedinPostId,
            caption,
            imageUrl,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            analytics: {
              likes: 0,
              comments: 0,
              lastFetchedAt: null as number | null,
            },
          },
          { merge: true }
        );
      } catch (e) {
        logger.warn('[linkedin] share Firestore post update failed', {
          message: (e as any)?.message,
          postId,
        });
        // Don't fail the whole request because of this
      }
    }

    res.status(200).json({ success: true, linkedinPostId, asset: assetUrn });
  } catch (e: any) {
    logger.warn('[linkedin] share unexpected error', { message: e?.message });
    res.status(500).json({ error: e?.message || 'Share failed' });
  }
}

/**
 * GET /api/linkedin/analytics?userId=xxx&postId=xxx
 * Fetches LinkedIn social metadata for the post and updates Firestore. Returns { likes, comments, lastFetchedAt }.
 */
async function handleLinkedInAnalytics(
  req: import('firebase-functions/v2/https').Request,
  res: {
    set: (k: string, v: string) => void;
    status: (n: number) => { json: (o: object) => void; end: () => void };
    json: (o: object) => void;
    end: () => void;
  }
): Promise<void> {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const userId = (req.query?.userId as string)?.trim();
  const postId = (req.query?.postId as string)?.trim();
  if (!userId || !postId) {
    res.status(400).json({ error: 'Missing userId or postId' });
    return;
  }

  const db = admin.firestore();
  try {
    const postDoc = await db.collection('posts').doc(postId).get();
    const data = postDoc.data();
    const linkedinPostId = data?.linkedinPostId as string | undefined;
    if (!linkedinPostId || (data?.userId as string) !== userId) {
      res.status(404).json({ error: 'Post not found or not a LinkedIn post' });
      return;
    }

    const accessToken = await getLinkedInAccessToken(userId);
    if (!accessToken) {
      res.status(401).json({ error: 'LinkedIn not connected or token expired' });
      return;
    }

    const analytics = await getLinkedInPostAnalytics(accessToken, linkedinPostId);
    await db.collection('posts').doc(postId).set(
      {
        analytics: {
          likes: analytics.likes,
          comments: analytics.comments,
          lastFetchedAt: analytics.lastFetchedAt,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.status(200).json({
      likes: analytics.likes,
      comments: analytics.comments,
      lastFetchedAt: analytics.lastFetchedAt,
    });
  } catch (e: any) {
    logger.warn('[linkedin] analytics error', { message: e?.message });
    res.status(500).json({ error: e?.message || 'Failed to fetch analytics' });
  }
}

/**
 * GET /api/linkedin/posts?userId=xxx
 * Returns list of user's LinkedIn posts (postId, caption, linkedinPostId, analytics) for the dashboard.
 */
async function handleLinkedInPosts(
  req: import('firebase-functions/v2/https').Request,
  res: {
    set: (k: string, v: string) => void;
    status: (n: number) => { json: (o: object) => void; end: () => void };
    json: (o: object) => void;
    end: () => void;
  }
): Promise<void> {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const userId = (req.query?.userId as string)?.trim();
  if (!userId) {
    res.status(400).json({ error: 'Missing userId' });
    return;
  }

  const db = admin.firestore();
  try {
    const snapshot = await db
      .collection('posts')
      .where('userId', '==', userId)
      .where('platform', '==', 'linkedin')
      .limit(100)
      .get();

    const posts = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          caption: d.caption ?? '',
          imageUrl: d.imageUrl ?? null,
          linkedinPostId: d.linkedinPostId ?? null,
          analytics: d.analytics ?? { likes: 0, comments: 0, lastFetchedAt: null },
          createdAt: d.createdAt?.toMillis?.() ?? null,
        };
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 50);

    res.status(200).json({ posts });
  } catch (e: any) {
    logger.warn('[linkedin] posts list error', { message: e?.message });
    res.status(500).json({ error: e?.message || 'Failed to list posts' });
  }
}

/**
 * POST /api/linkedin/suggestions — generate platform share suggestions on the backend.
 * Body: { reflection: string, platform: 'linkedin' | 'x' | 'reddit' }.
 *
 * This avoids calling OpenAI directly from the mobile app (which can fail with TypeError: Failed to fetch).
 */
async function handleLinkedInSuggestions(
  req: import('firebase-functions/v2/https').Request,
  res: {
    set: (k: string, v: string) => void;
    status: (n: number) => { json: (o: object) => void; end: () => void };
    json: (o: object) => void;
  }
): Promise<void> {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { reflection, platform } = (req.body || {}) as { reflection?: string; platform?: string };
    const t = (reflection || '').trim();
    const p = (platform || 'linkedin').toLowerCase();
    if (!t) {
      res.status(400).json({ error: 'Missing reflection' });
      return;
    }
    if (!['linkedin', 'x', 'reddit'].includes(p)) {
      res.status(400).json({ error: 'Invalid platform' });
      return;
    }

    const apiKey = (process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      res.status(500).json({ error: 'OPENAI_API_KEY is not set on backend' });
      return;
    }

    const platformLabel = p === 'x' ? 'X (Twitter)' : p.charAt(0).toUpperCase() + p.slice(1);
    const platformStyleGuide: Record<string, string> = {
      linkedin: `LINKEDIN STYLE (strict):
- Professional, polished tone. Thought-leadership or reflective professional narrative.
- Strong opening hook (question, observation, or bold line). Short paragraphs (1–3 lines).
- First person, authentic but career-friendly. Optional light insight or takeaway.
- End with 0–3 relevant hashtags. No emoji overload.`,
      x: `X (TWITTER) STYLE (strict):
- Very concise. Each post MUST be under 280 characters.
- Punchy, direct. Line breaks for emphasis. One clear idea per post.
- 1–2 hashtags max. Emoji sparingly if at all.`,
      reddit: `REDDIT STYLE (strict):
- Casual, conversational, like a personal story sub.
- First-person, relatable, authentic.
- Natural paragraph flow. No corporate speak.`
    };

    const styleGuide = platformStyleGuide[p] || platformStyleGuide.linkedin;
    const prompt = `You are turning a day's reflection into separate social posts. You MUST create one standalone post for EACH distinct event or moment mentioned in the reflection.

PLATFORM: ${platformLabel}. Write EVERY post in that platform's native style so it reads like a real ${platformLabel} post.

${styleGuide}

Output format (strict):
- For each post, first write exactly: EVENT: <short event label>
- Then on the next lines write the full post text.
- Separate each post with a line that contains only: ---

Reflection:
${t}`;

    const apiUrl = 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 2400
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.warn('[suggestions] openai not ok', { status: response.status, body: errText.slice(0, 200) });
      res.status(500).json({ error: `OpenAI error ${response.status}: ${errText.slice(0, 150)}` });
      return;
    }

    const data = (await response.json()) as any;
    const raw = (data?.choices?.[0]?.message?.content || '').trim();
    if (!raw) {
      res.status(200).json({ posts: [{ eventLabel: 'Reflection', post: t }] });
      return;
    }

    // Parse EVENT blocks (same parsing rules as frontend)
    let blocks = raw.split(/\n *--- *\n/).map((s: string) => s.trim()).filter(Boolean);
    if (blocks.length <= 1 && (raw.match(/EVENT:\s*/gi) || []).length >= 2) {
      const eventParts = raw.split(/\s*EVENT:\s*/i);
      blocks = eventParts
        .map((p2: string) => p2.trim())
        .filter(Boolean)
        .map((p2: string) => (p2.match(/^EVENT:/i) ? p2 : 'EVENT: ' + p2));
    }
    const result: Array<{ eventLabel: string; post: string }> = [];
    for (const block of blocks) {
      const eventMatch = block.match(/^EVENT:\s*(.+?)(?:\n|$)/i);
      const eventLabel = eventMatch ? eventMatch[1].trim() : '';
      const post = eventMatch ? block.slice(block.indexOf('\n') + 1).trim() : block.trim();
      if (post) result.push({ eventLabel: eventLabel || 'Moment', post });
    }
    res.status(200).json({ posts: result.length ? result : [{ eventLabel: 'Reflection', post: t }] });
  } catch (e: any) {
    logger.warn('[suggestions] unexpected error', { message: e?.message });
    res.status(500).json({ error: e?.message || 'Suggestions failed' });
  }
}

function decodeMaybeWrappedNewsUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    const qUrl = u.searchParams.get('url') || u.searchParams.get('q');
    if (qUrl && /^https?:\/\//i.test(qUrl)) return qUrl;
  } catch {
    // ignore parse errors
  }
  return trimmed;
}

function decodeMetaUrl(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let u = raw.trim().replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  if (u.startsWith('//')) u = `https:${u}`;
  return /^https?:\/\//i.test(u) ? u : null;
}

function decodeGoogleWrappedUrl(href: string): string | null {
  if (!href || typeof href !== 'string') return null;
  try {
    const u = new URL(href, 'https://news.google.com');
    const inner = u.searchParams.get('url') || u.searchParams.get('q');
    if (inner && /^https?:\/\//i.test(inner)) return inner;
  } catch {
    // ignore
  }
  // also handle percent-encoded url=... inside the string
  const m = href.match(/[?&](?:url|q)=(https%3A%2F%2F[^&]+)/i);
  if (m) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (decoded && /^https?:\/\//i.test(decoded)) return decoded;
    } catch {
      // ignore
    }
  }
  return null;
}

function isBlockedOutboundHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h === 'news.google.com' || h.endsWith('.news.google.com')) return true;
    if (h.endsWith('google.com') || h === 'gstatic.com' || h.endsWith('.gstatic.com')) return true;
    if (h.endsWith('gstatic.com')) return true;
    return false;
  } catch {
    return true;
  }
}

function isGoogleNewsArticleUrl(url: string): boolean {
  return typeof url === 'string' && /news\.google\.com\/(rss\/)?articles\//i.test(url);
}

function extractLikelyPublisherUrlFromGoogleNewsPageHtml(html: string): string | null {
  if (!html || typeof html !== 'string' || html.length < 200) return null;
  const re = /https?:\/\/[a-z0-9][-a-z0-9.]*[a-z0-9](?::\d+)?\/[^"'\\\s<>)]{12,900}/gi;
  let m: RegExpExecArray | null;
  let best: string | null = null;
  let bestScore = 0;
  while ((m = re.exec(html)) !== null) {
    let u = m[0].replace(/[),.;]+$/g, '');
    const decodedMeta = decodeMetaUrl(u);
    if (decodedMeta) u = decodedMeta;
    const unwrapped = decodeGoogleWrappedUrl(u);
    if (unwrapped) u = unwrapped;
    if (!u || isBlockedOutboundHost(u)) continue;
    try {
      const p = new URL(u);
      const score = p.pathname.length + (p.search ? 8 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    } catch {
      // ignore
    }
  }
  return best;
}

function pickMetaContent(doc: any, selectors: string[]): string {
  for (const s of selectors) {
    const el = doc.querySelector(s);
    const c = (el?.getAttribute('content') || '').trim();
    if (c) return c;
  }
  return '';
}

function cleanArticleText(raw: string): string {
  const t = (raw || '').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  return t.length > 16000 ? `${t.slice(0, 16000).trim()}\n...` : t;
}

/**
 * GET /api/linkedin/article?url=...
 * Returns normalized article fields for share generation:
 * { url, sourceUrl, title, image, text, source, description }
 */
async function handleArticleExtract(
  req: import('firebase-functions/v2/https').Request,
  res: {
    set: (k: string, v: string) => void;
    status: (n: number) => { json: (o: object) => void; end: () => void };
    json: (o: object) => void;
  }
): Promise<void> {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rawUrl = typeof req.query?.url === 'string' ? req.query.url : '';
    const resolved = decodeMaybeWrappedNewsUrl(rawUrl);
    if (!resolved || !/^https?:\/\//i.test(resolved)) {
      res.status(400).json({ error: 'Missing or invalid url query param' });
      return;
    }

    const response = await fetch(resolved, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn('[article] fetch not ok', { status: response.status, body: body.slice(0, 180), url: resolved });
      res.status(502).json({ error: `Could not fetch article (${response.status})` });
      return;
    }

    const initialFinalUrl = response.url || resolved;
    let html = await response.text();
    let finalUrl = initialFinalUrl;

    // If this is a Google News article shell, try to unpack the publisher URL
    // from the shell HTML and fetch the publisher page for real text/image.
    if (isGoogleNewsArticleUrl(finalUrl)) {
      const extractedPublisher = extractLikelyPublisherUrlFromGoogleNewsPageHtml(html);
      if (extractedPublisher && extractedPublisher !== finalUrl && !isBlockedOutboundHost(extractedPublisher)) {
        try {
          const pubRes = await fetch(extractedPublisher, {
            method: 'GET',
            redirect: 'follow',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
          if (pubRes.ok) {
            finalUrl = pubRes.url || extractedPublisher;
            html = await pubRes.text();
          }
        } catch {
          // keep shell HTML if publisher fetch fails
        }
      }
    }

    const dom = new JSDOM(html, { url: finalUrl });
    const doc = dom.window.document;
    const readable = new Readability(doc).parse();

    const title =
      pickMetaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
      (readable?.title || '').trim() ||
      (doc.querySelector('h1')?.textContent || '').trim() ||
      (doc.title || '').trim();
    const image = pickMetaContent(doc, [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ]);
    const description =
      pickMetaContent(doc, [
        'meta[property="og:description"]',
        'meta[name="description"]',
        'meta[name="twitter:description"]',
      ]) || (readable?.excerpt || '').trim();
    const text = cleanArticleText((readable?.textContent || '').trim());
    const source = (() => {
      try {
        return new URL(finalUrl).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();

    res.status(200).json({
      url: resolved,
      sourceUrl: finalUrl,
      title,
      image,
      text,
      source,
      description,
    });
  } catch (e: any) {
    logger.warn('[article] extraction error', { message: e?.message });
    res.status(500).json({ error: e?.message || 'Article extraction failed' });
  }
}

export const linkedInApi = onRequest(
  { cors: true },
  async (req, res) => {
    const path = (req.url || '').split('?')[0];
    if (path.endsWith('/exchange')) {
      return handleLinkedInExchange(req, res);
    }
    if (path.endsWith('/share')) {
      return handleLinkedInShare(req, res);
    }
    if (path.endsWith('/suggestions')) {
      return handleLinkedInSuggestions(req, res);
    }
    if (path.endsWith('/analytics')) {
      return handleLinkedInAnalytics(req, res);
    }
    if (path.endsWith('/posts')) {
      return handleLinkedInPosts(req, res);
    }
    if (path.endsWith('/article')) {
      return handleArticleExtract(req, res);
    }
    res.status(404).json({ error: 'Not found' });
  }
);

