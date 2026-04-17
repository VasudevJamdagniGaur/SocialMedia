/**
 * Vertex AI (Gemini) Express backend — service account only.
 * Run: node index.js
 */
import cors from "cors";
import express from "express";
import { LOCATION, MODEL_ID, PORT, PROJECT_ID } from "./lib/config.js";
import { generateText } from "./lib/generateText.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

function jsonError(res, status, message, details) {
  const body = { error: message };
  if (details) body.details = details;
  return res.status(status).json(body);
}

/** POST /chat → { message, temperature?, maxOutputTokens? } → { reply } — message is the full prompt (e.g. app system + user). */
app.post("/chat", async (req, res) => {
  try {
    const body = req.body ?? {};
    const { message } = body;
    if (typeof message !== "string" || !message.trim()) {
      return jsonError(res, 400, 'Missing or invalid "message" (non-empty string required)');
    }
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.65;
    const maxOutputTokens =
      typeof body.maxOutputTokens === "number"
        ? Math.min(Math.max(body.maxOutputTokens, 1), 8192)
        : 2048;
    const reply = await generateText(message.trim(), { temperature, maxOutputTokens });
    return res.json({ reply });
  } catch (err) {
    console.error("[/chat]", err);
    return jsonError(res, 500, "Chat generation failed", err.message);
  }
});

/** POST /reflection → { conversation } → { reflection } */
app.post("/reflection", async (req, res) => {
  try {
    const { conversation } = req.body ?? {};
    let text = "";
    if (typeof conversation === "string") {
      text = conversation.trim();
    } else if (conversation != null) {
      text = JSON.stringify(conversation, null, 2);
    }
    if (!text) {
      return jsonError(res, 400, 'Missing or invalid "conversation"');
    }
    const prompt = `You are a thoughtful coach. Read the conversation below and write a short, supportive reflection (2–4 paragraphs) on themes, emotions, and growth opportunities. Do not lecture; be warm and specific.

Conversation:
${text}`;
    const reflection = await generateText(prompt, { temperature: 0.65, maxOutputTokens: 2048 });
    return res.json({ reflection });
  } catch (err) {
    console.error("[/reflection]", err);
    return jsonError(res, 500, "Reflection generation failed", err.message);
  }
});

/** POST /summary → { text } → { summary } */
app.post("/summary", async (req, res) => {
  try {
    const { text } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      return jsonError(res, 400, 'Missing or invalid "text" (non-empty string required)');
    }
    const prompt = `Summarize the following content in clear, concise bullet points where appropriate. Preserve key facts and names.

Content:
${text.trim()}`;
    const summary = await generateText(prompt, { temperature: 0.3, maxOutputTokens: 2048 });
    return res.json({ summary });
  } catch (err) {
    console.error("[/summary]", err);
    return jsonError(res, 500, "Summary generation failed", err.message);
  }
});

/** POST /analyze-pattern → { data } → { result } */
app.post("/analyze-pattern", async (req, res) => {
  try {
    const { data } = req.body ?? {};
    let payload = "";
    if (typeof data === "string") {
      payload = data.trim();
    } else if (data != null) {
      payload = JSON.stringify(data, null, 2);
    }
    if (!payload) {
      return jsonError(res, 400, 'Missing or invalid "data"');
    }
    const prompt = `You are an analyst. Examine the structured or unstructured data below. Identify patterns, anomalies, and actionable insights. Respond with clear sections: Overview, Patterns, Recommendations.

Data:
${payload}`;
    const result = await generateText(prompt, { temperature: 0.4, maxOutputTokens: 4096 });
    return res.json({ result });
  } catch (err) {
    console.error("[/analyze-pattern]", err);
    return jsonError(res, 500, "Pattern analysis failed", err.message);
  }
});

/** Optional: text-only image concept (same model) */
app.post("/image-description", async (req, res) => {
  try {
    const { prompt } = req.body ?? {};
    if (typeof prompt !== "string" || !prompt.trim()) {
      return jsonError(res, 400, 'Missing or invalid "prompt"');
    }
    const full = `Describe a single detailed image that could illustrate the following (text only — do not claim to generate a binary image). Be vivid but concise (under 200 words).

Topic:
${prompt.trim()}`;
    const description = await generateText(full, { temperature: 0.8, maxOutputTokens: 1024 });
    return res.json({ description });
  } catch (err) {
    console.error("[/image-description]", err);
    return jsonError(res, 500, "Image description failed", err.message);
  }
});

/** Legacy: React chatService — Gemini-shaped JSON */
app.post("/generateContent", async (req, res) => {
  try {
    const body = req.body ?? {};
    const { prompt } = body;
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.65;
    const maxOutputTokens =
      typeof body.maxOutputTokens === "number"
        ? Math.min(Math.max(body.maxOutputTokens, 1), 8192)
        : 1024;

    if (typeof prompt !== "string" || !prompt.trim()) {
      return jsonError(res, 400, 'Missing required field: "prompt"');
    }

    const text = await generateText(prompt.trim(), { temperature, maxOutputTokens });

    return res.json({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text }],
          },
        },
      ],
    });
  } catch (err) {
    console.error("[/generateContent]", err);
    return jsonError(res, 500, "generateContent failed", err.message);
  }
});

app.post("/generatePost", async (req, res) => {
  try {
    const { news } = req.body ?? {};
    if (typeof news !== "string" || !news.trim()) {
      return jsonError(res, 400, 'Missing required field: "news"');
    }
    const prompt = `Convert this news into a short engaging social media post:\n\n${news.trim()}`;
    const post = await generateText(prompt, { temperature: 0.7, maxOutputTokens: 1024 });
    return res.json({ post });
  } catch (err) {
    console.error("[/generatePost]", err);
    return jsonError(res, 500, "generatePost failed", err.message);
  }
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    project: PROJECT_ID,
    location: LOCATION,
    model: MODEL_ID,
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) {
    jsonError(res, 500, "Internal server error", err.message);
  }
});

app.listen(process.env.PORT || 3001, "0.0.0.0", () => {
  console.log(`Vertex AI backend listening on http://localhost:${process.env.PORT || 3001}`);
  console.log(`  Project: ${PROJECT_ID}  Region: ${LOCATION}  Model: ${MODEL_ID}`);
  console.log(`  Credentials: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
});
