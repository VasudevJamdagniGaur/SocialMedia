/**
 * LinkedIn OAuth and Share API helpers.
 * All LinkedIn API calls run on the backend; client secret never exposed.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';

const REDIRECT_URI = 'https://deitedatabase.firebaseapp.com/auth/linkedin/callback';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_ME_URL = 'https://api.linkedin.com/v2/me';
const LINKEDIN_REGISTER_UPLOAD = 'https://api.linkedin.com/rest/assets?action=registerUpload';
const LINKEDIN_UGC_POSTS = 'https://api.linkedin.com/v2/ugcPosts';
const LINKEDIN_SOCIAL_METADATA_BASE = 'https://api.linkedin.com/rest/socialMetadata';

const RESTLI_HEADER = { 'X-Restli-Protocol-Version': '2.0.0' };
/** Required for LinkedIn REST APIs (e.g. rest/assets). */
const LINKEDIN_VERSION_HEADER = { 'LinkedIn-Version': '202410' };

export function getLinkedInConfig() {
  const clientId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
  const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret, redirectUri: REDIRECT_URI };
}

export interface TokenExchangeResult {
  access_token: string;
  expires_in: number;
  scope?: string;
}

/**
 * Exchange authorization code for access token.
 */
export async function exchangeCodeForToken(code: string): Promise<TokenExchangeResult> {
  const { clientId, clientSecret, redirectUri } = getLinkedInConfig();
  if (!clientId || !clientSecret) {
    throw new Error('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn('[linkedin] token exchange failed', { status: res.status, body: text?.slice(0, 200) });
    throw new Error(`LinkedIn token exchange failed: ${res.status}`);
  }

  return (await res.json()) as TokenExchangeResult;
}

/**
 * Get current member's person URN (e.g. urn:li:person:abc123).
 */
export async function getLinkedInPersonUrn(accessToken: string): Promise<string> {
  const res = await fetch(LINKEDIN_ME_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...RESTLI_HEADER,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn('[linkedin] /me failed', { status: res.status, body: text?.slice(0, 200) });
    throw new Error('Failed to get LinkedIn profile');
  }

  const data = (await res.json()) as { id?: string };
  const id = data?.id;
  if (!id) throw new Error('LinkedIn /me did not return id');
  return `urn:li:person:${id}`;
}

/**
 * Store LinkedIn token in Firestore: users/{uid}.linkedin (accessToken, expiresAt).
 * Caller may also set linkedinPersonUrn after getLinkedInPersonUrn().
 */
export async function storeLinkedInToken(
  uid: string,
  accessToken: string,
  expiresIn: number
): Promise<void> {
  const expiresAt = Date.now() + expiresIn * 1000;
  const db = admin.firestore();
  await db.collection('users').doc(uid).set(
    {
      linkedin: {
        accessToken,
        expiresAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
}

/**
 * Get valid LinkedIn access token for user from Firestore.
 * Returns null if missing or expired (within 5 min buffer).
 */
export async function getLinkedInAccessToken(uid: string): Promise<string | null> {
  const db = admin.firestore();
  const doc = await db.collection('users').doc(uid).get();
  const linkedin = doc.data()?.linkedin as { accessToken?: string; expiresAt?: number } | undefined;
  if (!linkedin?.accessToken) return null;
  const buffer = 5 * 60 * 1000; // 5 min
  if (linkedin.expiresAt && Date.now() + buffer >= linkedin.expiresAt) return null;
  return linkedin.accessToken;
}

export interface RegisterUploadResponse {
  value?: {
    uploadMechanism?: {
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: {
        uploadUrl: string;
      };
    };
    asset?: string;
  };
}

/**
 * Step 1: Register image upload with LinkedIn.
 */
export async function registerImageUpload(
  accessToken: string,
  personUrn: string,
  fileSizeBytes: number
): Promise<{ uploadUrl: string; asset: string }> {
  const body = {
    registerUploadRequest: {
      owner: personUrn,
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      serviceRelationships: [
        { identifier: 'urn:li:userGeneratedContent', relationshipType: 'OWNER' as const },
      ],
      supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD' as const],
      fileSize: fileSizeBytes,
    },
  };

  const res = await fetch(LINKEDIN_REGISTER_UPLOAD, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...RESTLI_HEADER,
      ...LINKEDIN_VERSION_HEADER,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn('[linkedin] registerUpload failed', { status: res.status, body: text?.slice(0, 300) });
    throw new Error(`LinkedIn registerUpload failed: ${res.status}`);
  }

  const data = (await res.json()) as RegisterUploadResponse;
  const uploadUrl =
    data.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const asset = data.value?.asset;
  if (!uploadUrl || !asset) throw new Error('LinkedIn registerUpload response missing uploadUrl or asset');
  return { uploadUrl, asset };
}

/**
 * Step 2: Upload image binary to LinkedIn uploadUrl.
 */
export async function uploadImageToLinkedIn(
  accessToken: string,
  uploadUrl: string,
  imageBuffer: Buffer,
  contentType: string
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': contentType || 'image/jpeg',
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn('[linkedin] image upload failed', { status: res.status, body: text?.slice(0, 200) });
    throw new Error(`LinkedIn image upload failed: ${res.status}`);
  }
}

const LINKEDIN_REST_ASSETS = 'https://api.linkedin.com/rest/assets';

/**
 * Extract asset id from URN (urn:li:digitalmediaAsset:XXXX -> XXXX).
 */
function assetUrnToId(assetUrn: string): string {
  const prefix = 'urn:li:digitalmediaAsset:';
  if (assetUrn.startsWith(prefix)) return assetUrn.slice(prefix.length);
  return assetUrn;
}

/**
 * Get asset status from LinkedIn REST API. Returns the recipe status (e.g. PROCESSING, AVAILABLE).
 */
export async function getLinkedInAssetStatus(
  accessToken: string,
  assetUrn: string
): Promise<string> {
  const assetId = assetUrnToId(assetUrn);
  const url = `${LINKEDIN_REST_ASSETS}/${encodeURIComponent(assetId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...RESTLI_HEADER,
      ...LINKEDIN_VERSION_HEADER,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn('[linkedin] getAsset failed', { status: res.status, body: text?.slice(0, 200) });
    throw new Error(`LinkedIn get asset failed: ${res.status}`);
  }

  const data = (await res.json()) as { recipes?: Array<{ recipe?: string; status?: string }> };
  const status = data.recipes?.[0]?.status ?? 'UNKNOWN';
  return status;
}

/**
 * Poll asset status until AVAILABLE or timeout. Required so the post is actually visible;
 * creating ugcPost before the asset is AVAILABLE can return 201 but the post won't appear.
 */
export async function waitForLinkedInAssetAvailable(
  accessToken: string,
  assetUrn: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number } = {}
): Promise<void> {
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const status = await getLinkedInAssetStatus(accessToken, assetUrn);
    if (status === 'AVAILABLE') return;
    if (status === 'CLIENT_ERROR' || status === 'SERVER_ERROR' || status === 'ABANDONED') {
      throw new Error(`LinkedIn asset failed with status: ${status}`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error('LinkedIn asset did not become AVAILABLE in time');
}

/**
 * Step 3: Create UGC post with caption and image asset.
 */
export async function createLinkedInUgcPost(
  accessToken: string,
  personUrn: string,
  caption: string,
  assetUrn: string
): Promise<string> {
  const body = {
    author: personUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: caption },
        shareMediaCategory: 'IMAGE',
        media: [
          {
            status: 'READY',
            media: assetUrn,
          },
        ],
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const res = await fetch(LINKEDIN_UGC_POSTS, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...RESTLI_HEADER,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn('[linkedin] ugcPosts failed', { status: res.status, body: text?.slice(0, 300) });
    throw new Error(`LinkedIn create post failed: ${res.status}`);
  }

  // Post ID can be in header (x-restli-id) or in response body (id)
  const xRestliId = res.headers.get('x-restli-id')?.trim();
  let data: { id?: string };
  try {
    data = (await res.json()) as { id?: string };
  } catch {
    data = {};
  }
  const bodyId = data?.id;
  const id = bodyId || xRestliId;
  if (!id) throw new Error('LinkedIn ugcPosts did not return post id (body or x-restli-id)');
  return id;
}

/** UGC post URN for social metadata (id from API may be full URN or numeric). */
function toUgcPostUrn(id: string): string {
  if (!id) throw new Error('LinkedIn post id is required');
  if (id.startsWith('urn:li:ugcPost:')) return id;
  return `urn:li:ugcPost:${id}`;
}

export interface LinkedInPostAnalytics {
  likes: number;
  comments: number;
  lastFetchedAt: number | null;
}

/**
 * Fetch social metadata (reactions + comments) for a UGC post.
 * Requires r_member_social or equivalent; may be restricted by LinkedIn.
 */
export async function getLinkedInPostAnalytics(
  accessToken: string,
  ugcPostIdOrUrn: string
): Promise<LinkedInPostAnalytics> {
  const urn = toUgcPostUrn(ugcPostIdOrUrn);
  const url = `${LINKEDIN_SOCIAL_METADATA_BASE}/${encodeURIComponent(urn)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...RESTLI_HEADER,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn('[linkedin] socialMetadata failed', { status: res.status, body: text?.slice(0, 200) });
    throw new Error(`LinkedIn social metadata failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    reactionSummaries?: Record<string, { reactionType?: string; count?: number }>;
    commentSummary?: { count?: number; topLevelCount?: number };
  };

  let likes = 0;
  if (data.reactionSummaries && typeof data.reactionSummaries === 'object') {
    for (const key of Object.keys(data.reactionSummaries)) {
      const count = data.reactionSummaries[key]?.count ?? 0;
      likes += count;
    }
  }
  const comments = data.commentSummary?.count ?? 0;

  return {
    likes,
    comments,
    lastFetchedAt: Date.now(),
  };
}
