"use strict";
/**
 * LinkedIn OAuth and Share API helpers.
 * All LinkedIn API calls run on the backend; client secret never exposed.
 */
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
exports.createLinkedInUgcPost = exports.uploadImageToLinkedIn = exports.registerImageUpload = exports.getLinkedInAccessToken = exports.storeLinkedInToken = exports.getLinkedInPersonUrn = exports.exchangeCodeForToken = exports.getLinkedInConfig = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
const REDIRECT_URI = 'https://deitedatabase.firebaseapp.com/auth/linkedin/callback';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_ME_URL = 'https://api.linkedin.com/v2/me';
const LINKEDIN_REGISTER_UPLOAD = 'https://api.linkedin.com/rest/assets?action=registerUpload';
const LINKEDIN_UGC_POSTS = 'https://api.linkedin.com/v2/ugcPosts';
const RESTLI_HEADER = { 'X-Restli-Protocol-Version': '2.0.0' };
function getLinkedInConfig() {
    const clientId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
    const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
    return { clientId, clientSecret, redirectUri: REDIRECT_URI };
}
exports.getLinkedInConfig = getLinkedInConfig;
/**
 * Exchange authorization code for access token.
 */
async function exchangeCodeForToken(code) {
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
        firebase_functions_1.logger.warn('[linkedin] token exchange failed', { status: res.status, body: text?.slice(0, 200) });
        throw new Error(`LinkedIn token exchange failed: ${res.status}`);
    }
    return (await res.json());
}
exports.exchangeCodeForToken = exchangeCodeForToken;
/**
 * Get current member's person URN (e.g. urn:li:person:abc123).
 */
async function getLinkedInPersonUrn(accessToken) {
    const res = await fetch(LINKEDIN_ME_URL, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...RESTLI_HEADER,
        },
    });
    if (!res.ok) {
        const text = await res.text();
        firebase_functions_1.logger.warn('[linkedin] /me failed', { status: res.status, body: text?.slice(0, 200) });
        throw new Error('Failed to get LinkedIn profile');
    }
    const data = (await res.json());
    const id = data?.id;
    if (!id)
        throw new Error('LinkedIn /me did not return id');
    return `urn:li:person:${id}`;
}
exports.getLinkedInPersonUrn = getLinkedInPersonUrn;
/**
 * Store LinkedIn token in Firestore: users/{uid}.linkedin (accessToken, expiresAt).
 * Caller may also set linkedinPersonUrn after getLinkedInPersonUrn().
 */
async function storeLinkedInToken(uid, accessToken, expiresIn) {
    const expiresAt = Date.now() + expiresIn * 1000;
    const db = admin.firestore();
    await db.collection('users').doc(uid).set({
        linkedin: {
            accessToken,
            expiresAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
    }, { merge: true });
}
exports.storeLinkedInToken = storeLinkedInToken;
/**
 * Get valid LinkedIn access token for user from Firestore.
 * Returns null if missing or expired (within 5 min buffer).
 */
async function getLinkedInAccessToken(uid) {
    const db = admin.firestore();
    const doc = await db.collection('users').doc(uid).get();
    const linkedin = doc.data()?.linkedin;
    if (!linkedin?.accessToken)
        return null;
    const buffer = 5 * 60 * 1000; // 5 min
    if (linkedin.expiresAt && Date.now() + buffer >= linkedin.expiresAt)
        return null;
    return linkedin.accessToken;
}
exports.getLinkedInAccessToken = getLinkedInAccessToken;
/**
 * Step 1: Register image upload with LinkedIn.
 */
async function registerImageUpload(accessToken, personUrn, fileSizeBytes) {
    const body = {
        registerUploadRequest: {
            owner: personUrn,
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            serviceRelationships: [
                { identifier: 'urn:li:userGeneratedContent', relationshipType: 'OWNER' },
            ],
            supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'],
            fileSize: fileSizeBytes,
        },
    };
    const res = await fetch(LINKEDIN_REGISTER_UPLOAD, {
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
        firebase_functions_1.logger.warn('[linkedin] registerUpload failed', { status: res.status, body: text?.slice(0, 300) });
        throw new Error(`LinkedIn registerUpload failed: ${res.status}`);
    }
    const data = (await res.json());
    const uploadUrl = data.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
    const asset = data.value?.asset;
    if (!uploadUrl || !asset)
        throw new Error('LinkedIn registerUpload response missing uploadUrl or asset');
    return { uploadUrl, asset };
}
exports.registerImageUpload = registerImageUpload;
/**
 * Step 2: Upload image binary to LinkedIn uploadUrl.
 */
async function uploadImageToLinkedIn(accessToken, uploadUrl, imageBuffer, contentType) {
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
        firebase_functions_1.logger.warn('[linkedin] image upload failed', { status: res.status, body: text?.slice(0, 200) });
        throw new Error(`LinkedIn image upload failed: ${res.status}`);
    }
}
exports.uploadImageToLinkedIn = uploadImageToLinkedIn;
/**
 * Step 3: Create UGC post with caption and image asset.
 */
async function createLinkedInUgcPost(accessToken, personUrn, caption, assetUrn) {
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
        firebase_functions_1.logger.warn('[linkedin] ugcPosts failed', { status: res.status, body: text?.slice(0, 300) });
        throw new Error(`LinkedIn create post failed: ${res.status}`);
    }
    const data = (await res.json());
    const id = data?.id;
    if (!id)
        throw new Error('LinkedIn ugcPosts did not return post id');
    return id;
}
exports.createLinkedInUgcPost = createLinkedInUgcPost;
//# sourceMappingURL=linkedin.js.map