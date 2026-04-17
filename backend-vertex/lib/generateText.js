import { VertexAI } from "@google-cloud/vertexai";
import { LOCATION, MODEL_ID, PROJECT_ID } from "./config.js";

/** Single client instance for the whole process */
const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

/** Single model — gemini-2.5-flash */
const model = vertexAI.getGenerativeModel({ model: MODEL_ID });

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
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt.trim() }] }],
      generationConfig: { temperature, maxOutputTokens },
    });
    const text = extractTextFromResult(result);
    return text;
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Vertex generateContent failed: ${msg}`);
  }
}
