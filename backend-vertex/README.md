# Vertex AI (Gemini) Express Backend

Express backend server that calls Google Vertex AI Gemini using the official `@google-cloud/vertexai` SDK and **Application Default Credentials (ADC)**.

## Prerequisites (no API keys)

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

Server runs on `http://localhost:3000`.

## Endpoint

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

