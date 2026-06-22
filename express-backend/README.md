# Express Reddit proxy

Architecture for **Flutter web** (and mobile):

```
Flutter app  →  Express (this server)  →  Reddit API
```

Browsers block direct `reddit.com` requests (CORS). This server fetches Reddit server-side and returns JSON.

## Run locally

```bash
cd express-backend
npm install
npm start
```

Default: `http://localhost:3002`

## Flutter web

```bash
cd flutter_app
flutter run -d chrome --dart-define=BACKEND_URL=http://localhost:3002
```

## Endpoints

| GET | Description |
|-----|-------------|
| `/health` | Health check |
| `/api/reddit/hot?sub=BollyBlindsNGossip&limit=50` | Tea / subreddit hot listing |
| `/api/news?url=<encoded reddit json url>` | Legacy passthrough |

## Production

Deploy to Render/Railway/Fly (set `PORT`). Point Flutter builds at the deployed URL:

```bash
flutter build web --dart-define=BACKEND_URL=https://your-reddit-proxy.onrender.com
```

The Dart server in `server/` also exposes the same routes when you deploy `socitea-backend` on Render.
