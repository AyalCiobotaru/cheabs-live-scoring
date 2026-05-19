# Cheabs Live Scoring

Standalone mobile-first volleyball pool scoring app.

## Features

- Pool Sheet photo capture and browser-side OCR parsing
- Admin-created event codes for live scoring access
- Multiple pools per event with editable pool setup
- Live in-progress match scoring with Ably pub/sub
- Pool standings from completed matches
- 31-day event, pool setup, and final score persistence with Upstash Redis
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

Set these values in `.env` for the API:

- `ABLY_API_KEY` enables live sync.
- `ADMIN_PASSWORD` allows admins to create events and edit pool setup.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` persist events, pool setup, and finalized matches for 31 days.

## Future Plans

- Editable best-guess playoff brackets
