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
  createLinkedInUgcPost,
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
 */
async function handleLinkedInShare(req: import('firebase-functions/v2/https').Request, res: { set: (k: string, v: string) => void; status: (n: number) => { json: (o: object) => void; end: () => void }; json: (o: object) => void }): Promise<void> {
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
    const { userId, caption, imageUrl, postId } = (req.body || {}) as {
      userId?: string;
      caption?: string;
      imageUrl?: string;
      postId?: string;
    };
    if (!userId || !caption || !imageUrl) {
      res.status(400).json({ error: 'Missing userId, caption, or imageUrl' });
      return;
    }

    const accessToken = await getLinkedInAccessToken(userId);
    if (!accessToken) {
      res.status(401).json({ error: 'LinkedIn not connected or token expired' });
      return;
    }

    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userId).get();
    const personUrn = (userDoc.data()?.linkedin as { linkedinPersonUrn?: string } | undefined)?.linkedinPersonUrn;
    if (!personUrn) {
      res.status(400).json({ error: 'LinkedIn person URN not found; reconnect LinkedIn' });
      return;
    }

    // Fetch image from URL
    const imageRes = await fetch(imageUrl, { method: 'GET' });
    if (!imageRes.ok) throw new Error('Failed to fetch image from URL');
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';

    const { uploadUrl, asset } = await registerImageUpload(accessToken, personUrn, imageBuffer.length);
    await uploadImageToLinkedIn(accessToken, uploadUrl, imageBuffer, contentType);
    const linkedinPostId = await createLinkedInUgcPost(accessToken, personUrn, caption, asset);

    if (postId) {
      await db.collection('posts').doc(postId).set(
        {
          platform: 'linkedin',
          linkedinPostId,
          caption,
          imageUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    res.status(200).json({ linkedinPostId });
  } catch (e: any) {
    logger.warn('[linkedin] share error', { message: e?.message });
    res.status(500).json({ error: e?.message || 'Share failed' });
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
    res.status(404).json({ error: 'Not found' });
  }
);

