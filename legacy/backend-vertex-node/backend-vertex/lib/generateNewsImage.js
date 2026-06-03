/**
 * Gemini image on Vertex (nano banana / flash-image; env VERTEX_NANO_BANANA_IMAGE_MODEL).
 * Requires: Vertex AI API enabled, billing, service account with aiplatform.user role.
 */
import { GoogleGenAI, Modality } from "@google/genai";
import { PROJECT_ID, LOCATION } from "./config.js";

const IMAGE_MODEL =
  process.env.VERTEX_NANO_BANANA_IMAGE_MODEL ||
  process.env.VERTEX_GEMINI_IMAGE_MODEL ||
  "gemini-2.5-flash-image";

/**
 * @param {import('@google/genai').GenerateContentResponse} response
 * @returns {string|null} data URL or null
 */
function extractImageDataUrl(response) {
  try {
    const fromGetter = typeof response?.data === "string" ? response.data.trim() : "";
    if (fromGetter.length > 40) {
      return `data:image/png;base64,${fromGetter}`;
    }
  } catch {
    /* ignore */
  }
  try {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    for (const p of parts) {
      const id = p?.inlineData ?? p?.inline_data;
      if (!id?.data) continue;
      const mime = (id.mimeType || id.mime_type || "image/png").trim();
      const data = String(id.data).replace(/\s/g, "");
      if (!data) continue;
      return `data:${mime};base64,${data}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {string} prompt - Full image prompt (caller may include story context)
 * @returns {Promise<string|null>} data:image/... URL or null
 */
export async function generateNewsIllustrationImage(prompt) {
  const body = String(prompt || "").trim();
  if (!body) return null;

  const safePrefix =
    "Create a single editorial illustration for a news story. " +
    "Tasteful and symbolic or environmental; no graphic violence, gore, or identifiable private individuals. " +
    "No text, captions, or logos in the image. " +
    "Use a medium or wide shot when people appear; avoid face close-ups.\n\n";

  const full = `${safePrefix}${body.slice(0, 6000)}`;

  const ai = new GoogleGenAI({
    vertexai: true,
    project: PROJECT_ID,
    location: LOCATION,
  });

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: full }],
      },
    ],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const url = extractImageDataUrl(response);
  if (!url) {
    console.error("[generateNewsIllustrationImage] No image part in response");
  }
  return url;
}
