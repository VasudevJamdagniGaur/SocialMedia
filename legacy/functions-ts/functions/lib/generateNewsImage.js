"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNewsImage = void 0;
/**
 * Fallback when Render backend has not deployed POST /generate-news-image yet.
 * Same Vertex image stack as backend-vertex/lib/generateNewsImage.js
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const genai_1 = require("@google/genai");
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const IMAGE_MODEL = process.env.VERTEX_NANO_BANANA_IMAGE_MODEL ||
    process.env.VERTEX_GEMINI_IMAGE_MODEL ||
    'gemini-2.5-flash-image';
function extractImageDataUrl(response) {
    try {
        const r = response;
        const fromGetter = typeof r?.data === 'string' ? r.data.trim() : '';
        if (fromGetter.length > 40) {
            return `data:image/png;base64,${fromGetter}`;
        }
    }
    catch {
        /* ignore */
    }
    try {
        const r = response;
        const parts = r?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts))
            return null;
        for (const p of parts) {
            const id = p?.inlineData ?? p?.inline_data;
            if (!id?.data)
                continue;
            const mime = (id.mimeType || id.mime_type || 'image/png').trim();
            const data = String(id.data).replace(/\s/g, '');
            if (!data)
                continue;
            return `data:${mime};base64,${data}`;
        }
    }
    catch {
        /* ignore */
    }
    return null;
}
exports.generateNewsImage = (0, https_1.onRequest)({
    cors: true,
    timeoutSeconds: 300,
    memory: '1GiB',
    region: 'us-central1',
}, async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
        res.status(400).json({ error: 'Missing or invalid "prompt"' });
        return;
    }
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
    if (!projectId) {
        firebase_functions_1.logger.error('[generateNewsImage] GCLOUD_PROJECT not set');
        res.status(500).json({ error: 'Server misconfiguration: project id' });
        return;
    }
    try {
        const safePrefix = 'Create a single editorial illustration for a news story. ' +
            'Tasteful and symbolic or environmental; no graphic violence, gore, or identifiable private individuals. ' +
            'No text, captions, or logos in the image. ' +
            'Use a medium or wide shot when people appear; avoid face close-ups.\n\n';
        const full = `${safePrefix}${prompt.slice(0, 6000)}`;
        const ai = new genai_1.GoogleGenAI({
            vertexai: true,
            project: projectId,
            location: LOCATION,
        });
        const response = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: full,
            config: {
                responseModalities: [genai_1.Modality.TEXT, genai_1.Modality.IMAGE],
            },
        });
        const imageDataUrl = extractImageDataUrl(response);
        if (!imageDataUrl) {
            res.status(502).json({ error: 'Image generation returned no image' });
            return;
        }
        res.json({ imageDataUrl });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        firebase_functions_1.logger.error('[generateNewsImage]', msg);
        res.status(500).json({ error: 'Image generation failed', details: msg });
    }
});
//# sourceMappingURL=generateNewsImage.js.map