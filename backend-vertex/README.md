# Vertex AI (Gemini) Express Backend

Express backend for **Google Vertex AI** via `@google-cloud/vertexai`, authenticated with a **service account JSON** (no Google AI API keys).

## Configuration

| Variable | Default |
|----------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | `<backend-vertex>/service-account.json` |
| `GOOGLE_CLOUD_PROJECT` | `offgrid-492919` |
| `VERTEX_LOCATION` | `us-central1` |
| `VERTEX_GEMINI_MODEL` | `gemini-2.5-flash` |
| `PORT` | `3001` |

## Run

```bash
cd backend-vertex
npm install
node index.js
```

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/chat` | `{ message }` | `{ reply }` |
| POST | `/reflection` | `{ conversation }` | `{ reflection }` |
| POST | `/summary` | `{ text }` | `{ summary }` |
| POST | `/analyze-pattern` | `{ data }` | `{ result }` |
| POST | `/image-description` | `{ prompt }` | `{ description }` (text-only) |
| POST | `/generateContent` | `{ prompt, temperature?, maxOutputTokens? }` | Legacy Gemini shape |
| POST | `/generatePost` | `{ news }` | `{ post }` |
| GET | `/health` | — | `{ ok, project, location, model }` |

## React app

```env
REACT_APP_BACKEND_URL=https://detea-backend.onrender.com
```
