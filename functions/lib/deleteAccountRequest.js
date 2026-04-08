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
exports.deleteAccountRequest = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
/** Practical email check — not full RFC 5322; sufficient for Play compliance intake. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(raw) {
    if (typeof raw !== 'string')
        return null;
    const t = raw.trim().toLowerCase();
    if (!t || t.length > 320)
        return null;
    if (!EMAIL_RE.test(t))
        return null;
    return t;
}
function parseBody(req) {
    const body = req.body;
    if (body == null)
        return {};
    if (typeof body === 'object' && !Array.isArray(body)) {
        return body;
    }
    if (typeof body === 'string') {
        try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
            return null;
        }
        catch {
            return null;
        }
    }
    return null;
}
/**
 * POST JSON { "email": string } — stores a pending account deletion request for manual processing.
 * CORS enabled for browser form on Firebase Hosting.
 */
exports.deleteAccountRequest = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
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
        firebase_functions_1.logger.info('[deleteAccountRequest] pending request stored', {
            emailHint: `${email.slice(0, 2)}***@${email.split('@')[1] || '?'}`,
        });
        res.status(200).json({ success: true, message: 'Deletion request submitted' });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        firebase_functions_1.logger.error('[deleteAccountRequest] firestore error', { message: msg });
        res.status(500).json({
            success: false,
            error: 'Could not submit your request. Please try again later.',
        });
    }
});
//# sourceMappingURL=deleteAccountRequest.js.map