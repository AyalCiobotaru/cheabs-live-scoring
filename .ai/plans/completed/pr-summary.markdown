## Summary

Refactored the frontend into a routed Angular app with clearer file organization and shared event state management.

## Changes

- Replaced the single `scoring-page` mode-switcher with Angular routes:
  - `/`
  - `/events/:eventCode`
  - `/events/:eventCode/pools/:poolId`
  - `/events/:eventCode/pools/:poolId/setup`
  - `/events/:eventCode/new-pool`
- Moved shell/layout ownership into `AppComponent`.
- Added `ScoringEventStateService` to centralize event loading, admin state, realtime updates, local persistence, pool setup drafts, scoring actions, OCR scan state, and navigation behavior.
- Added route components under `src/app/routes`.
- Added reusable UI components under `src/app/components`.
- Split models into focused files under `src/app/models`.
- Moved services under `src/app/service`.
- Moved pure scoring helpers/rules under `src/app/util`.
- Added admin setup guard for protected pool setup routes.
- Preserved admin sign-in flow with redirect back to the originally requested setup route.
- Added readable event and pool URLs with direct-link support.
- Added division filtering through Event View query params.
- Removed redundant `scoring` directory and old `scoring-page`/`event-shell` structure.
- Added ESLint and Prettier configuration.
- Added Vercel Analytics and Speed Insights.
- Updated README future plans.
- Moved OCR/Tesseract processing to the browser and removed image preprocessing that reduced OCR quality.

## Verification

- `npm run lint`
- `npm run format:check`
- `npm run build`
- `node --check server\handler.mjs`
