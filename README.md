# Cheabs Live Scoring

Standalone mobile-first outdoor volleyball pool scoring app.

## Features

- Pool Sheet photo capture and server-side OCR parsing
- Editable pool title, teams, format, and match order
- Live match scoring with Ably pub/sub
- Pool standings from completed matches
- Vercel-compatible Angular frontend and Node API

## Local Development

```powershell
npm install
npm run start:api
```

In another terminal:

```powershell
cd frontend
npm install
npm start
```

Set `ABLY_API_KEY` in `.env` to enable live sync. Leave it blank for local-only mode.
