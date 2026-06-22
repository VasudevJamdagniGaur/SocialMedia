# Deite Dart server

Unified backend in **Dart** — replaces `backend-vertex/` (Node), `socitea-proxy/` (Node), and HTTP routes from `functions/` (TypeScript).

## Endpoints

| Method | Path | Source |
|--------|------|--------|
| GET | `/health` | backend-vertex |
| POST | `/chat`, `/reflection`, `/summary`, `/analyze-pattern` | backend-vertex |
| POST | `/generateContent`, `/generatePost`, `/generate-news-image` | backend-vertex |
| GET | `/api/news/everything`, `/api/news/top-headlines` | functions/newsApi.ts |
| GET | `/api/reddit/hot?sub=&limit=` | Reddit hot listing (Tea, Pod) |
| GET | `/api/news` | socitea-proxy (Reddit URL passthrough) |
| GET | `/api/linkedin/article?url=` | functions/index.ts article extract |
| POST | `/api/linkedin/suggestions?stream=1` | SSE streaming suggestions |
| POST | `/deleteAccountRequest` | functions/deleteAccountRequest.ts |

Firestore triggers (`generatePostEmbedding`, scheduled `newsIngest`) remain deployable from `legacy/functions/` until ported to Cloud Run cron.

## Run locally

```powershell
cd server
dart pub get
# Copy service-account.json or set GOOGLE_APPLICATION_CREDENTIALS
dart run bin/server.dart
```

Environment variables: `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION`, `VERTEX_GEMINI_MODEL`, `NEWSAPI_KEY`, `OPENAI_API_KEY`, `PORT`.

## Deploy (Render)

Set **Root Directory** to `server`. Uses `Dockerfile` + `/health` check.
