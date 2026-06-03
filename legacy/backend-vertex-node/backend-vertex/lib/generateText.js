import { VertexAI } from "@google-cloud/vertexai";
import { LOCATION, MODEL_ID, PROJECT_ID } from "./config.js";

/** Single client instance for the whole process */
const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

const FALLBACK_MODELS = [
  MODEL_ID,
  // Commonly-available Gemini models on Vertex AI (best-effort fallbacks)
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-002",
  "gemini-1.5-flash",
].filter(Boolean);

function isNotFoundModelError(err) {
  const msg = (err?.message || String(err || "")).toLowerCase();
  // VertexAI.ClientError shows up as: "got status: 404 Not Found ... Publisher Model ... was not found"
  return msg.includes("got status: 404") || msg.includes("not_found") || msg.includes("publisher model") || msg.includes("was not found");
}

function getModel(modelId) {
  return vertexAI.getGenerativeModel({ model: modelId });
}

/**
 * @param {import('@google-cloud/vertexai').GenerateContentResult} result
 */
function extractTextFromResult(result) {
  const parts = result?.response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

/**
 * Reusable Vertex text generation (service account only).
 *
 * @param {string} prompt
 * @param {{ temperature?: number, maxOutputTokens?: number }} [options]
 * @returns {Promise<string>}
 */
export async function generateText(prompt, options = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("prompt must be a non-empty string");
  }

  const temperature = typeof options.temperature === "number" ? options.temperature : 0.65;
  const rawMax = Number(options.maxOutputTokens) || 2048;
  const maxOutputTokens = Math.min(Math.max(rawMax, 1), 8192);

  try {
    let lastErr = null;
    for (const mid of FALLBACK_MODELS) {
      try {
        const model = getModel(mid);
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt.trim() }] }],
          generationConfig: { temperature, maxOutputTokens },
        });
        const text = extractTextFromResult(result);
        return text;
      } catch (err) {
        lastErr = err;
        // If the model ID is invalid / inaccessible, try the next fallback.
        if (isNotFoundModelError(err)) continue;
        throw err;
      }
    }
    throw lastErr || new Error("No Gemini model available");
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Vertex generateContent failed: ${msg}`);
  }
}
