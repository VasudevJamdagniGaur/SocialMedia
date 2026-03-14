"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.linkedInApi = exports.generatePostEmbedding = void 0;
const path = __importStar(require("path"));
const dotenv_1 = require("dotenv");
// Load functions/.env so LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are available (local emulator).
// In production, set these in Firebase Console → Project → Functions → Environment variables.
(0, dotenv_1.config)({ path: path.resolve(__dirname, '..', '.env') });
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const linkedin_1 = require("./linkedin");
admin.initializeApp();
function getEmbeddingServiceConfig() {
    const url = (process.env.EMBEDDING_SERVICE_URL || '').trim();
    const apiKey = (process.env.EMBEDDING_SERVICE_API_KEY || '').trim();
    return { url, apiKey };
}
async function fetchEmbedding256(text, imageUrl, postId, apiUrl, apiKey) {
    if (!apiUrl)
        return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
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
            firebase_functions_1.logger.warn('[embedding] service not ok', { status: res.status, body: txt?.slice(0, 300) });
            return null;
        }
        const data = (await res.json());
        const v = data?.embedding_vector;
        if (!Array.isArray(v) || v.length !== 256)
            return null;
        // basic sanity
        if (v.some((x) => typeof x !== 'number' || Number.isNaN(x)))
            return null;
        return v;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[embedding] fetch failed', { message: e?.message || String(e) });
        return null;
    }
    finally {
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
exports.generatePostEmbedding = (0, firestore_1.onDocumentCreated)('communityPosts/{postId}', async (event) => {
    const snap = event.data;
    const postId = event.params.postId;
    if (!snap)
        return;
    const post = snap.data();
    if (!post)
        return;
    // Idempotency guard
    if (Array.isArray(post.embedding_vector) && post.embedding_vector.length === 256) {
        return;
    }
    const text = (post.text_content || post.content || '').trim();
    const imageUrl = (post.image_url || post.image || '').trim();
    const { url, apiKey } = getEmbeddingServiceConfig();
    if (!url) {
        firebase_functions_1.logger.warn('[embedding] EMBEDDING_SERVICE_URL not set; skipping', { postId });
        return;
    }
    const embedding = await fetchEmbedding256(text, imageUrl, postId, url, apiKey);
    if (!embedding) {
        firebase_functions_1.logger.warn('[embedding] could not generate embedding', { postId });
        return;
    }
    await snap.ref.set({
        embedding_vector: embedding,
        embedding_updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
});
// ---------- LinkedIn OAuth & Share (backend only; client secret never exposed) ----------
/**
 * POST /api/linkedin/exchange — exchange auth code for token, store in Firestore.
 * Body: { code: string, state?: string } (state = Firebase uid to associate token).
 */
async function handleLinkedInExchange(req, res) {
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
        const { code, state } = (req.body || {});
        if (!code || typeof code !== 'string') {
            res.status(400).json({ error: 'Missing or invalid code' });
            return;
        }
        const uid = (state && typeof state === 'string') ? state.trim() : null;
        if (!uid) {
            res.status(400).json({ error: 'Missing state (Firebase uid)' });
            return;
        }
        const tokenResult = await (0, linkedin_1.exchangeCodeForToken)(code);
        await (0, linkedin_1.storeLinkedInToken)(uid, tokenResult.access_token, tokenResult.expires_in);
        const personUrn = await (0, linkedin_1.getLinkedInPersonUrn)(tokenResult.access_token);
        const db = admin.firestore();
        await db.collection('users').doc(uid).set({
            linkedin: {
                accessToken: tokenResult.access_token,
                expiresAt: Date.now() + tokenResult.expires_in * 1000,
                linkedinPersonUrn: personUrn,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
        }, { merge: true });
        res.status(200).json({ success: true, linkedinConnected: true });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[linkedin] exchange error', { message: e?.message });
        res.status(500).json({ error: e?.message || 'Token exchange failed' });
    }
}
/**
 * POST /api/linkedin/share — create LinkedIn UGC post with image; optionally update Firestore post doc.
 * Body: { userId: string, caption: string, imageUrl: string, postId?: string }.
 */
async function handleLinkedInShare(req, res) {
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
        const { userId, caption, imageUrl, postId } = (req.body || {});
        if (!userId || !caption || !imageUrl) {
            res.status(400).json({ error: 'Missing userId, caption, or imageUrl' });
            return;
        }
        const accessToken = await (0, linkedin_1.getLinkedInAccessToken)(userId);
        if (!accessToken) {
            res.status(401).json({ error: 'LinkedIn not connected or token expired' });
            return;
        }
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const personUrn = userDoc.data()?.linkedin?.linkedinPersonUrn;
        if (!personUrn) {
            res.status(400).json({ error: 'LinkedIn person URN not found; reconnect LinkedIn' });
            return;
        }
        // Fetch image from URL
        const imageRes = await fetch(imageUrl, { method: 'GET' });
        if (!imageRes.ok)
            throw new Error('Failed to fetch image from URL');
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
        const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
        const { uploadUrl, asset } = await (0, linkedin_1.registerImageUpload)(accessToken, personUrn, imageBuffer.length);
        await (0, linkedin_1.uploadImageToLinkedIn)(accessToken, uploadUrl, imageBuffer, contentType);
        const linkedinPostId = await (0, linkedin_1.createLinkedInUgcPost)(accessToken, personUrn, caption, asset);
        if (postId) {
            await db.collection('posts').doc(postId).set({
                platform: 'linkedin',
                linkedinPostId,
                caption,
                imageUrl,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        res.status(200).json({ linkedinPostId });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[linkedin] share error', { message: e?.message });
        res.status(500).json({ error: e?.message || 'Share failed' });
    }
}
exports.linkedInApi = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
    const path = (req.url || '').split('?')[0];
    if (path.endsWith('/exchange')) {
        return handleLinkedInExchange(req, res);
    }
    if (path.endsWith('/share')) {
        return handleLinkedInShare(req, res);
    }
    res.status(404).json({ error: 'Not found' });
});
//# sourceMappingURL=index.js.map