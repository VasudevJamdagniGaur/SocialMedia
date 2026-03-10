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
exports.generatePostEmbedding = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
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
//# sourceMappingURL=index.js.map