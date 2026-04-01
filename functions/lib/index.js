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
exports.linkedInApi = exports.newsApi = exports.generatePostEmbedding = void 0;
const path = __importStar(require("path"));
const dotenv_1 = require("dotenv");
// Load functions/.env so LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are available (local emulator).
// In production, set these in Firebase Console → Project → Functions → Environment variables.
(0, dotenv_1.config)({ path: path.resolve(__dirname, '..', '.env') });
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const jsdom_1 = require("jsdom");
const readability_1 = require("@mozilla/readability");
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
 *
 * Implements LinkedIn's 3‑step image upload flow:
 * 1) registerUpload → get upload URL + asset URN
 * 2) PUT image bytes to upload URL
 * 3) POST ugcPosts with the asset URN attached
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
    const db = admin.firestore();
    try {
        const { userId, caption, imageUrl, postId } = (req.body || {});
        // Step 0: validate payload
        if (!userId || !caption || !imageUrl) {
            res.status(400).json({ error: 'Missing userId, caption, or imageUrl' });
            return;
        }
        // Step 1: get LinkedIn accessToken + person URN from Firestore
        let accessToken = null;
        let personUrn;
        try {
            accessToken = await (0, linkedin_1.getLinkedInAccessToken)(userId);
            const userDoc = await db.collection('users').doc(userId).get();
            const linkedin = userDoc.data()?.linkedin;
            personUrn = linkedin?.linkedinPersonUrn;
            if (!personUrn && linkedin?.personId) {
                personUrn = `urn:li:person:${linkedin.personId}`;
            }
        }
        catch (e) {
            firebase_functions_1.logger.warn('[linkedin] share step 1 (load credentials) failed', { message: e?.message, userId });
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
        let imageBuffer;
        let contentType;
        try {
            const imageRes = await fetch(imageUrl, { method: 'GET' });
            if (!imageRes.ok) {
                const text = await imageRes.text().catch(() => '');
                firebase_functions_1.logger.warn('[linkedin] share step 2 (fetch image) failed', {
                    status: imageRes.status,
                    body: text.slice(0, 200),
                });
                res.status(500).json({ error: 'Failed to fetch image from URL' });
                return;
            }
            const arr = await imageRes.arrayBuffer();
            imageBuffer = Buffer.from(arr);
            contentType = imageRes.headers.get('content-type') || 'image/jpeg';
        }
        catch (e) {
            firebase_functions_1.logger.warn('[linkedin] share step 2 (download image) error', { message: e?.message });
            res.status(500).json({ error: 'Error downloading image' });
            return;
        }
        // Step 3.1: registerUpload with LinkedIn
        let uploadUrl;
        let assetUrn;
        try {
            const { uploadUrl: u, asset } = await (0, linkedin_1.registerImageUpload)(accessToken, personUrn, imageBuffer.length);
            uploadUrl = u;
            assetUrn = asset;
        }
        catch (e) {
            firebase_functions_1.logger.warn('[linkedin] share step 3.1 (registerUpload) failed', { message: e?.message });
            res.status(500).json({ error: 'LinkedIn registerUpload failed' });
            return;
        }
        // Step 3.2: upload image bytes
        try {
            await (0, linkedin_1.uploadImageToLinkedIn)(accessToken, uploadUrl, imageBuffer, contentType);
        }
        catch (e) {
            firebase_functions_1.logger.warn('[linkedin] share step 3.2 (image upload) failed', { message: e?.message });
            res.status(500).json({ error: 'LinkedIn image upload failed' });
            return;
        }
        // Step 3.2b: wait for asset to be AVAILABLE so the post actually appears on LinkedIn.
        // If the status check fails (e.g. 403 on GET asset), wait 5s and proceed anyway.
        try {
            await (0, linkedin_1.waitForLinkedInAssetAvailable)(accessToken, assetUrn, { maxWaitMs: 30000, pollIntervalMs: 2000 });
            firebase_functions_1.logger.info('[linkedin] share step 3.2b: asset AVAILABLE');
        }
        catch (e) {
            const msg = e?.message ?? '';
            firebase_functions_1.logger.warn('[linkedin] share step 3.2b (wait for asset) failed', { message: msg });
            // Fallback: wait 5s then create post anyway (GET asset may return 403 for some tokens)
            firebase_functions_1.logger.info('[linkedin] share step 3.2b: fallback 5s delay before create');
            await new Promise((r) => setTimeout(r, 5000));
        }
        // Step 3.3: create UGC post
        let linkedinPostId;
        try {
            linkedinPostId = await (0, linkedin_1.createLinkedInUgcPost)(accessToken, personUrn, caption, assetUrn);
            firebase_functions_1.logger.info('[linkedin] share step 3.3: post created', { linkedinPostId });
        }
        catch (e) {
            firebase_functions_1.logger.warn('[linkedin] share step 3.3 (ugcPosts) failed', { message: e?.message });
            res.status(500).json({ error: 'LinkedIn post creation failed' });
            return;
        }
        // Optional: update your posts collection
        if (postId) {
            try {
                await db.collection('posts').doc(postId).set({
                    platform: 'linkedin',
                    linkedinPostId,
                    caption,
                    imageUrl,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    analytics: {
                        likes: 0,
                        comments: 0,
                        lastFetchedAt: null,
                    },
                }, { merge: true });
            }
            catch (e) {
                firebase_functions_1.logger.warn('[linkedin] share Firestore post update failed', {
                    message: e?.message,
                    postId,
                });
                // Don't fail the whole request because of this
            }
        }
        res.status(200).json({ success: true, linkedinPostId, asset: assetUrn });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[linkedin] share unexpected error', { message: e?.message });
        res.status(500).json({ error: e?.message || 'Share failed' });
    }
}
/**
 * GET /api/linkedin/analytics?userId=xxx&postId=xxx
 * Fetches LinkedIn social metadata for the post and updates Firestore. Returns { likes, comments, lastFetchedAt }.
 */
async function handleLinkedInAnalytics(req, res) {
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
    const userId = req.query?.userId?.trim();
    const postId = req.query?.postId?.trim();
    if (!userId || !postId) {
        res.status(400).json({ error: 'Missing userId or postId' });
        return;
    }
    const db = admin.firestore();
    try {
        const postDoc = await db.collection('posts').doc(postId).get();
        const data = postDoc.data();
        const linkedinPostId = data?.linkedinPostId;
        if (!linkedinPostId || data?.userId !== userId) {
            res.status(404).json({ error: 'Post not found or not a LinkedIn post' });
            return;
        }
        const accessToken = await (0, linkedin_1.getLinkedInAccessToken)(userId);
        if (!accessToken) {
            res.status(401).json({ error: 'LinkedIn not connected or token expired' });
            return;
        }
        const analytics = await (0, linkedin_1.getLinkedInPostAnalytics)(accessToken, linkedinPostId);
        await db.collection('posts').doc(postId).set({
            analytics: {
                likes: analytics.likes,
                comments: analytics.comments,
                lastFetchedAt: analytics.lastFetchedAt,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.status(200).json({
            likes: analytics.likes,
            comments: analytics.comments,
            lastFetchedAt: analytics.lastFetchedAt,
        });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[linkedin] analytics error', { message: e?.message });
        res.status(500).json({ error: e?.message || 'Failed to fetch analytics' });
    }
}
/**
 * GET /api/linkedin/posts?userId=xxx
 * Returns list of user's LinkedIn posts (postId, caption, linkedinPostId, analytics) for the dashboard.
 */
async function handleLinkedInPosts(req, res) {
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
    const userId = req.query?.userId?.trim();
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
    }
    catch (e) {
        firebase_functions_1.logger.warn('[linkedin] posts list error', { message: e?.message });
        res.status(500).json({ error: e?.message || 'Failed to list posts' });
    }
}
/**
 * POST /api/linkedin/suggestions — generate platform share suggestions on the backend.
 * Body: { reflection: string, platform: 'linkedin' | 'x' | 'reddit' }.
 *
 * This avoids calling OpenAI directly from the mobile app (which can fail with TypeError: Failed to fetch).
 */
async function handleLinkedInSuggestions(req, res) {
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
        const { reflection, platform } = (req.body || {});
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
        const platformStyleGuide = {
            linkedin: `LINKEDIN STYLE (strict — follow all):

UNIQUE INSIGHT (do not merely summarize the day):
- Derive a sharp insight from what they wrote: client or colleague questions, building in public, tensions, tradeoffs, or lessons learned.
- Personal backstory or biography: ONLY if the user explicitly said it in the reflection below. Paraphrase only facts they stated. If nothing relevant appears, omit backstory entirely — never invent or assume a past.

ONE POST = ONE IDEA (journalist mindset):
- Each post has one clear angle and one main takeaway, like a strong lead — not a laundry list of unrelated points.

STRUCTURE (skimmable):
- Write for skimmers: short paragraphs, optional bullet points, or a tight framework when it fits (e.g. Problem → tension → lesson, or a short story arc to one point). Plain, simple language.

HOOK (first ~2 lines are critical):
- Open with something that earns the scroll: a number, direct address ("you"), a striking detail from THEIR reflection, or a sharp question. The hook must match the single idea.

DELIVER + CLOSE:
- The body must fulfill the hook’s promise. End with a clear call to action (one question, comment prompt, or one concrete next step).

POLISH:
- First person where natural. 0–3 relevant hashtags. No meta ("here’s my LinkedIn post"). Emoji only if light and natural.`,
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
        const linkedinReflectionExtra = p === 'linkedin'
            ? `
LinkedIn (extra — every post):
- Again: no invented personal history. Backstory only when the reflection explicitly contains it.
- Hook in the opening lines; skimmable middle; explicit CTA at the end.
`
            : '';
        const linkedinStep2 = p === 'linkedin'
            ? `
For LinkedIn posts only: one clear angle each; strong hook in the first two lines; skimmable structure (short paragraphs and/or bullets); deliver on the hook; end with a CTA; never fabricate backstory not present in the reflection.
`
            : '';
        const prompt = `You are turning a day's reflection into separate social posts. You MUST create one standalone post for EACH distinct event or moment mentioned in the reflection.

PLATFORM: ${platformLabel}. Write EVERY post in that platform's native style so it reads like a real ${platformLabel} post.

${styleGuide}
${linkedinReflectionExtra}
Cover every distinct event or moment from the reflection (people, places, media, work, funny moments). Each post focuses on one event only — insightful and reflective, not a dry summary.
${linkedinStep2}
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
            firebase_functions_1.logger.warn('[suggestions] openai not ok', { status: response.status, body: errText.slice(0, 200) });
            res.status(500).json({ error: `OpenAI error ${response.status}: ${errText.slice(0, 150)}` });
            return;
        }
        const data = (await response.json());
        const raw = (data?.choices?.[0]?.message?.content || '').trim();
        if (!raw) {
            res.status(200).json({ posts: [{ eventLabel: 'Reflection', post: t }] });
            return;
        }
        // Parse EVENT blocks (same parsing rules as frontend)
        let blocks = raw.split(/\n *--- *\n/).map((s) => s.trim()).filter(Boolean);
        if (blocks.length <= 1 && (raw.match(/EVENT:\s*/gi) || []).length >= 2) {
            const eventParts = raw.split(/\s*EVENT:\s*/i);
            blocks = eventParts
                .map((p2) => p2.trim())
                .filter(Boolean)
                .map((p2) => (p2.match(/^EVENT:/i) ? p2 : 'EVENT: ' + p2));
        }
        const result = [];
        for (const block of blocks) {
            const eventMatch = block.match(/^EVENT:\s*(.+?)(?:\n|$)/i);
            const eventLabel = eventMatch ? eventMatch[1].trim() : '';
            const post = eventMatch ? block.slice(block.indexOf('\n') + 1).trim() : block.trim();
            if (post)
                result.push({ eventLabel: eventLabel || 'Moment', post });
        }
        res.status(200).json({ posts: result.length ? result : [{ eventLabel: 'Reflection', post: t }] });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[suggestions] unexpected error', { message: e?.message });
        res.status(500).json({ error: e?.message || 'Suggestions failed' });
    }
}
function decodeMaybeWrappedNewsUrl(rawUrl) {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed)
        return '';
    try {
        const u = new URL(trimmed);
        const qUrl = u.searchParams.get('url') || u.searchParams.get('q');
        if (qUrl && /^https?:\/\//i.test(qUrl))
            return qUrl;
    }
    catch {
        // ignore parse errors
    }
    return trimmed;
}
function decodeMetaUrl(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    let u = raw.trim().replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (u.startsWith('//'))
        u = `https:${u}`;
    return /^https?:\/\//i.test(u) ? u : null;
}
function decodeGoogleWrappedUrl(href) {
    if (!href || typeof href !== 'string')
        return null;
    try {
        const u = new URL(href, 'https://news.google.com');
        const inner = u.searchParams.get('url') || u.searchParams.get('q');
        if (inner && /^https?:\/\//i.test(inner))
            return inner;
    }
    catch {
        // ignore
    }
    // also handle percent-encoded url=... inside the string
    const m = href.match(/[?&](?:url|q)=(https%3A%2F%2F[^&]+)/i);
    if (m) {
        try {
            const decoded = decodeURIComponent(m[1]);
            if (decoded && /^https?:\/\//i.test(decoded))
                return decoded;
        }
        catch {
            // ignore
        }
    }
    return null;
}
function isBlockedOutboundHost(url) {
    try {
        const h = new URL(url).hostname.toLowerCase();
        if (h === 'news.google.com' || h.endsWith('.news.google.com'))
            return true;
        if (h.endsWith('google.com') || h === 'gstatic.com' || h.endsWith('.gstatic.com'))
            return true;
        if (h.endsWith('gstatic.com'))
            return true;
        return false;
    }
    catch {
        return true;
    }
}
function isGoogleNewsArticleUrl(url) {
    return typeof url === 'string' && /news\.google\.com\/(rss\/)?articles\//i.test(url);
}
function extractLikelyPublisherUrlFromGoogleNewsPageHtml(html) {
    if (!html || typeof html !== 'string' || html.length < 200)
        return null;
    const re = /https?:\/\/[a-z0-9][-a-z0-9.]*[a-z0-9](?::\d+)?\/[^"'\\\s<>)]{12,900}/gi;
    let m;
    let best = null;
    let bestScore = 0;
    while ((m = re.exec(html)) !== null) {
        let u = m[0].replace(/[),.;]+$/g, '');
        const decodedMeta = decodeMetaUrl(u);
        if (decodedMeta)
            u = decodedMeta;
        const unwrapped = decodeGoogleWrappedUrl(u);
        if (unwrapped)
            u = unwrapped;
        if (!u || isBlockedOutboundHost(u))
            continue;
        try {
            const p = new URL(u);
            const score = p.pathname.length + (p.search ? 8 : 0);
            if (score > bestScore) {
                bestScore = score;
                best = u;
            }
        }
        catch {
            // ignore
        }
    }
    return best;
}
function pickMetaContent(doc, selectors) {
    for (const s of selectors) {
        const el = doc.querySelector(s);
        const c = (el?.getAttribute('content') || '').trim();
        if (c)
            return c;
    }
    return '';
}
function cleanArticleText(raw) {
    const t = (raw || '').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
    return t.length > 16000 ? `${t.slice(0, 16000).trim()}\n...` : t;
}
/**
 * GET /api/linkedin/article?url=...
 * Returns normalized article fields for share generation:
 * { url, sourceUrl, title, image, text, source, description }
 */
async function handleArticleExtract(req, res) {
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            firebase_functions_1.logger.warn('[article] fetch not ok', { status: response.status, body: body.slice(0, 180), url: resolved });
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
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
                            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        },
                    });
                    if (pubRes.ok) {
                        finalUrl = pubRes.url || extractedPublisher;
                        html = await pubRes.text();
                    }
                }
                catch {
                    // keep shell HTML if publisher fetch fails
                }
            }
        }
        const dom = new jsdom_1.JSDOM(html, { url: finalUrl });
        const doc = dom.window.document;
        const readable = new readability_1.Readability(doc).parse();
        const title = pickMetaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
            (readable?.title || '').trim() ||
            (doc.querySelector('h1')?.textContent || '').trim() ||
            (doc.title || '').trim();
        const image = pickMetaContent(doc, [
            'meta[property="og:image"]',
            'meta[property="og:image:url"]',
            'meta[name="twitter:image"]',
            'meta[name="twitter:image:src"]',
        ]);
        const description = pickMetaContent(doc, [
            'meta[property="og:description"]',
            'meta[name="description"]',
            'meta[name="twitter:description"]',
        ]) || (readable?.excerpt || '').trim();
        const text = cleanArticleText((readable?.textContent || '').trim());
        const source = (() => {
            try {
                return new URL(finalUrl).hostname.replace(/^www\./, '');
            }
            catch {
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
    }
    catch (e) {
        firebase_functions_1.logger.warn('[article] extraction error', { message: e?.message });
        res.status(500).json({ error: e?.message || 'Article extraction failed' });
    }
}
var newsApi_1 = require("./newsApi");
Object.defineProperty(exports, "newsApi", { enumerable: true, get: function () { return newsApi_1.newsApi; } });
exports.linkedInApi = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
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
});
//# sourceMappingURL=index.js.map