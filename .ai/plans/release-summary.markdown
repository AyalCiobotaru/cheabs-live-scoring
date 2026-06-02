## Release Summary

Initial release of Cheabs Live Scoring, a mobile-first live scoring app for volleyball pool play.

## What It Does

- Create or join an event using a human-readable event code.
- View an event dashboard showing all pools in the event.
- Group pools by division, with division filtering available from the menu.
- Open a specific pool from the Event View.
- View pool standings with team name, wins, losses, and point differential.
- View current/next match information for each pool.
- Score matches live from the Pool View.
- Mark matches final to persist results.
- Keep live, in-progress scoring synced through Ably while users are actively scoring.
- Persist finalized matches and event/pool setup through Upstash.
- Support one-month event history through persisted event data.
- Add and edit pools as an admin.
- Configure pool title, division, team count, games per match, target score, teams, and schedule.
- Read pool sheet photos in the browser with Tesseract.js to prefill pool setup.
- Show OCR read summaries with read, assumed, and manual-review items.
- Preserve pool sheet images locally only; pool images are not synced.
- Show side-switch reminders for games to 11 and games to 15.
- Allow non-admin users to view pools and score matches.
- Require admin sign-in for event creation and pool setup changes.
- Use a single global admin password configured through deployment environment variables.

## Navigation

- `/` - choose or create an event
- `/events/:eventCode` - Event View
- `/events/:eventCode/pools/:poolId` - Pool View
- `/events/:eventCode/pools/:poolId/setup` - edit pool setup
- `/events/:eventCode/new-pool` - create a new pool

## Admin Flow

- Admins can create events.
- Admins can add and edit pools.
- Non-admin users can join existing events, view pools, score matches, and mark matches final.
- Admin-only setup routes prompt for sign-in and then return to the originally requested route.

## Technical Notes

- Frontend is an Angular app with route-based navigation.
- Event state, realtime sync, persistence, scoring actions, setup drafts, admin state, and OCR scan state are centralized in a shared frontend service.
- Realtime scoring uses Ably.
- Persistent event and finalized match data use Upstash.
- OCR runs in the browser with Tesseract.js to avoid serverless function timeouts.
- Vercel Analytics and Speed Insights are wired into the frontend.
- ESLint and Prettier are configured for frontend code quality and formatting.

## Verification

- `npm run lint`
- `npm run format:check`
- `npm run build`
- `node --check server\handler.mjs`
