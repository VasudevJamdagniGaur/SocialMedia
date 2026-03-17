import * as path from 'path';
import { config as loadEnv } from 'dotenv';

// Load functions/.env so LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are available (local emulator).
// In production, set these in Firebase Console → Project → Functions → Environment variables.
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
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

    // Step 3.2b: wait for asset to be AVAILABLE so the post actually appears on LinkedIn
    try {
      await waitForLinkedInAssetAvailable(accessToken, assetUrn, { maxWaitMs: 30_000, pollIntervalMs: 2_000 });
    } catch (e) {
      logger.warn('[linkedin] share step 3.2b (wait for asset) failed', { message: (e as any)?.message });
      res.status(500).json({ error: 'LinkedIn image is still processing; try again in a moment' });
      return;
    }

    // Step 3.3: create UGC post
    let linkedinPostId: string;
    try {
      linkedinPostId = await createLinkedInUgcPost(accessToken, personUrn, caption, assetUrn);
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
  res: { set: (k: string, v: string) => void; status: (n: number) => { json: (o: object) => void }; json: (o: object) => void }
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
  res: { set: (k: string, v: string) => void; status: (n: number) => { json: (o: object) => void }; json: (o: object) => void }
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
    if (path.endsWith('/analytics')) {
      return handleLinkedInAnalytics(req, res);
    }
    if (path.endsWith('/posts')) {
      return handleLinkedInPosts(req, res);
    }
    res.status(404).json({ error: 'Not found' });
  }
);

