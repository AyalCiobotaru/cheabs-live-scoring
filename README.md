# Cheabs Live Scoring

Standalone mobile-first volleyball pool scoring app for creating events, running pool play, and sharing live standings.

## Features

- Admin-created event codes for live scoring access
- Multiple divisions and pools per event with editable pool setup
- Pool Sheet photo capture with OCR-assisted setup
- Manual pool setup with configurable teams, matches, scoring format, caps, and saved schedule presets
- Live in-progress match scoring with Ably pub/sub
- Pool standings from completed matches
- Match start timer support between matches
- Browser-local pool favorites with a favorites-only dashboard view across divisions
- Admin event import from CSV with preview, validation, and template downloads
- Semi-structured event import template generation for common pool sizes
- Seeded team import for an existing event from CSV or XLSX
- Seeded import pool generation with snake seeding, schedule selection, 4/5-team pool preferences, and special handling for 6, 7, and 11 teams
- Division-scoped bulk pool creation with append or replace behavior
- 31-day event, pool setup, and final score persistence with Upstash Redis
- Vercel-compatible Angular frontend and Node API

## Local Development

```powershell
pnpm install
pnpm start:api
```

In another terminal:

```powershell
pnpm --dir frontend start
```

Set these values in `.env` for the API:

- `ABLY_API_KEY` enables live sync.
- `ADMIN_PASSWORD` allows admins to create events and edit pool setup.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` persist events, pool setup, and finalized matches for 31 days.

## Admin Import Workflows

### Full Event Import

Admins can create a new event from a CSV file. The import flow previews the event, pools, teams, schedules, scoring settings, and validation issues before creating the event. A blank template and a semi-structured template generator are available from the import page.

### Seeded Pool Import

For an event that already exists, admins can import a seeded team list by division from CSV or XLSX. The importer previews generated pools before saving them and can either append to the selected division or replace existing pools in that division.

Seeded import supports:

- Headered `seed,team_name` files
- Headerless `seed,team_name` files
- One-column team lists with seeds inferred by row order
- Duplicate seed blocking errors and duplicate team name warnings
- Per-pool-size scoring settings
- Per-pool-size schedule preset selection with schedule preview tooltips
- Optional prioritization of 5-team pools before filling remaining teams into 4-team pools

## Pool Favorites

Users can favorite pools from the event dashboard. Favorites are stored in the browser's local storage per event, so they do not require sign-in and do not affect other users. The Favorites view shows favorited pools across all divisions in that event.

## Future Plans

- Editable best-guess playoff brackets
- Division-based dashboard filters
