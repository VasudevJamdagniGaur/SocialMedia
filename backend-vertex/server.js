import express from "express";
import cors from "cors";
import { VertexAI } from "@google-cloud/vertexai";

const PORT = Number(process.env.PORT) || 3001;

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "project-c212527d-22ac-4bbe-aaf";
const LOCATION = process.env.VERTEX_LOCATION || "us-central1";
const MODEL = process.env.VERTEX_GEMINI_MODEL || "gemini-2.5-flash";

const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
const generativeModel = vertexAI.getGenerativeModel({ model: MODEL });

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

/** Proxy for the React app: plain-text prompt in, Gemini-shaped JSON out (matches generativelanguage parsing in chatService). */
app.post("/generateContent", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const { prompt } = body;
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.65;
    const maxOutputTokens =
      typeof body.maxOutputTokens === "number"
        ? Math.min(Math.max(body.maxOutputTokens, 1), 8192)
        : 1024;

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({ message: 'Missing required field: "prompt"' });
    }

    const result = await generativeModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt.trim() }] }],
      generationConfig: {
        temperature,
        maxOutputTokens,
      },
    });

    const response = result?.response;
    const text =
      response?.candidates?.[0]?.content?.parts
        ?.map((p) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim() ?? "";

    const candidate0 = response?.candidates?.[0];
    return res.json({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text }],
          },
          finishReason: candidate0?.finishReason,
          safetyRatings: candidate0?.safetyRatings,
        },
      ],
    });
  } catch (err) {
    return next(err);
  }
});

app.post("/generatePost", async (req, res, next) => {
  try {
    const { news } = req.body ?? {};

    if (typeof news !== "string" || news.trim().length === 0) {
      return res.status(400).json({ message: 'Missing required field: "news"' });
    }

    const prompt = `Convert this news into a short engaging social media post:\n\n${news.trim()}`;

    const result = await generativeModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const response = result?.response;
    const post =
      response?.candidates?.[0]?.content?.parts
        ?.map((p) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim() ?? "";

    return res.json({ post });
  } catch (err) {
    return next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Vertex AI backend listening on http://localhost:${PORT}`);
});
