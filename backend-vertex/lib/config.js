/**
 * Vertex AI backend — service account JSON only (no API keys).
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(ROOT, "service-account.json");
}

export const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "offgrid-492919";
export const LOCATION = process.env.VERTEX_LOCATION || "us-central1";

/** Single Vertex Gemini model (see Vertex AI model garden for your project). */
export const MODEL_ID = process.env.VERTEX_GEMINI_MODEL || "gemini-2.5-flash";

export const PORT = Number(process.env.PORT) || 3001;
