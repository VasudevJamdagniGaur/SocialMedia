import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

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

