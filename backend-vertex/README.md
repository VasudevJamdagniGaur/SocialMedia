# Vertex AI (Gemini) Express Backend

Express backend server that calls Google Vertex AI Gemini using the official `@google-cloud/vertexai` SDK and **Application Default Credentials (ADC)**.

## Prerequisites (no API keys in the app)

- Node.js 18+
- Google Cloud CLI authenticated with ADC (one-time):

```bash
gcloud auth application-default login
```

- (Recommended) Ensure ADC uses the correct quota project:

```bash
gcloud auth application-default set-quota-project project-c212527d-22ac-4bbe-aaf
```

## Install

From the repo root:

```bash
cd backend-vertex
npm install
```

## Run

```bash
npm start
```

Default URL: **`http://localhost:3001`** (port avoids clashing with Create React App on 3000).

Override port:

```bash
set PORT=3002
npm start
```

Optional env vars:

| Variable | Description |
|----------|-------------|
| `PORT` | Listen port (default `3001`) |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (default in `server.js`) |
| `VERTEX_LOCATION` | Region (default `us-central1`) |
| `VERTEX_GEMINI_MODEL` | Model id (default `gemini-2.5-flash`) |

## Endpoints

### POST `/generateContent`

Used by the Detea app when `REACT_APP_VERTEX_GEMINI_URL` is set (chat with Gemini selected, share suggestions, etc.).

Request body:

```json
{
  "prompt": "Your full prompt text",
  "temperature": 0.65,
  "maxOutputTokens": 1024
}
```

Response: Gemini-shaped JSON with `candidates[0].content.parts[0].text`.

### POST `/generatePost`

Request body:

```json
{
  "news": "Your news text here"
}
```

Response:

```json
{
  "post": "generated text"
}
```

## Wire the React app

In the project root `.env`:

```env
REACT_APP_VERTEX_GEMINI_URL=http://localhost:3001
```

Restart `npm start` for the React app so the variable is picked up.

With Gemini selected in Chat, messages go through this backend instead of `REACT_APP_GOOGLE_API_KEY`. Share suggestion **post text** also prefers Vertex when this URL is set. **Gemini image generation** in the app still uses the Google AI API key unless you add a separate image route.
