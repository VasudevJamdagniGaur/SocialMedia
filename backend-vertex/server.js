import express from "express";
import cors from "cors";
import { VertexAI } from "@google-cloud/vertexai";

const PORT = 3000;

const PROJECT_ID = "project-c212527d-22ac-4bbe-aaf";
const LOCATION = "us-central1";
const MODEL = "gemini-1.5-flash";

const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
const generativeModel = vertexAI.getGenerativeModel({ model: MODEL });

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.post("/generatePost", async (req, res, next) => {
  try {
    const { news } = req.body ?? {};

    if (typeof news !== "string" || news.trim().length === 0) {
      return res.status(400).json({ message: 'Missing required field: "news"' });
    }

    const prompt = `Convert this news into a short engaging social media post:\n\n${news.trim()}`;

    const result = await generativeModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }]
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
  // Keep error responses consistent and avoid leaking internals.
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Vertex AI backend listening on http://localhost:${PORT}`);
});

