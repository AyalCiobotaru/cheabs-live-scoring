# Angular Routing Decision Tree

## Goal

Decide whether to replace the current single `scoring-page` route with Angular routes for the major app screens, and define the route/state design before implementation.

Current `scoring-page` owns too many responsibilities:

- choose/create event
- event dashboard
- pool view
- pool setup
- admin sign-in overlay
- selected division filter
- active pool selection
- realtime connection lifecycle
- local persistence

The routing idea is to move screen selection into Angular routes instead of keeping it inside `viewMode` and `activePoolId`.

## Proposed Route Shape

```txt
/
  choose/create event

/events/:eventCode
  Event View dashboard

/events/:eventCode/pools/:poolId
  Pool View

/events/:eventCode/pools/:poolId/setup
  Pool setup/edit

/events/:eventCode/new-pool
  Add pool setup
```

## Recommended Component Shape

```txt
scoring/
  event-shell.component.*
  pages/
    choose-event-page/
    event-dashboard-page/
    pool-page/
    pool-setup-page/
  components/
  service/
  models/
  util/
```

`EventShellComponent` would own event-level orchestration:

- load event by `eventCode`
- connect/disconnect realtime
- hold admin state
- render shared side menu
- provide event state to child route pages
- host a child `router-outlet`

Child route pages would own screen-specific UI:

- choose/create event
- Event View
- Pool View
- Pool Setup

## Key Pushback

Do not add routes while keeping the current `scoring-page` as the central mode-switcher.

That would create URLs, but it would not improve the architecture much. The route work should come with a frontend event state service so routed components can share the same event, pool, realtime, and persistence logic cleanly.

## Proposed Implementation Order

1. Rename `scoring-page` to `event-shell`.
2. Extract event state/realtime/persistence from the page into a frontend state service.
3. Add routed page components.
4. Add routes for choose event, event dashboard, pool view, pool setup, and new pool.
5. Make the shell load event context for `/events/:eventCode`.
6. Remove `viewMode` and `activePoolId` UI navigation state from the shell/page.

## Questions To Answer

### 1. Event Code In URL

Should event code be visible and shareable in the URL?

Recommendation: yes. If someone joins `STRIVE-BASH`, the URL should become `/events/STRIVE-BASH`. Refresh, sharing, browser back, and direct links then work naturally.

Answer: yes

### 2. Pool ID In URL

Should a specific pool be direct-linkable?

Recommendation: yes. Pool View should be `/events/:eventCode/pools/:poolId`, so someone can share a direct link to a pool.

Answer: yes

### 3. Invalid Pool URL

If a user opens `/events/:eventCode/pools/:poolId` and that pool does not exist, what should happen?

Options:

- redirect to Event View
- show a “pool not found” message
- redirect to the first available pool

Recommendation: redirect to Event View. It is the least disruptive and keeps users inside the event.

Answer:yes

### 4. Admin-Only Setup Routes

If a non-admin opens `/events/:eventCode/pools/:poolId/setup`, what should happen?

Options:

- redirect to Pool View
- show admin sign-in and continue to setup after success
- show a locked message

Recommendation: show admin sign-in and continue to setup after success.

Answer:yes

### 5. New Pool Route Draft Behavior

If someone refreshes halfway through `/events/:eventCode/new-pool`, should the draft setup be preserved?

Options:

- lose draft on refresh
- preserve draft locally

Recommendation: lose draft for v1 unless already saved. Simpler and less surprising.

Answer:agreed, lose draft for v1

### 6. Event Shell Component

Are we comfortable creating an `EventShellComponent` whose job is event-level orchestration rather than screen UI?

Recommendation: yes. This keeps route pages small and avoids duplicating event loading/realtime logic.

Answer:yes

### 7. Frontend Event State Service

Are we comfortable adding a frontend state service for event state, active event loading, persistence, and realtime updates?

Recommendation: yes. This is the key prerequisite. Without it, routes may spread the current complexity across multiple components.

Answer:yes

### 8. Browser Back Behavior

Expected flow:

```txt
Choose Event -> Event View -> Pool View -> Setup
```

Browser back would go:

```txt
Setup -> Pool View -> Event View -> Choose Event
```

Is that the behavior we want?

Recommendation: yes. Treat “Choose Event” as a normal route at `/`, and let the explicit Choose Event button navigate there.

Answer:yes

### 9. URL Style

Readable:

```txt
/events/:eventCode
/events/:eventCode/pools/:poolId
```

Short:

```txt
/e/:eventCode
/e/:eventCode/p/:poolId
```

Recommendation: use readable URLs. This app is not URL-length constrained.

Answer:readable URLs

## Open Follow-Ups

### 10. Invalid Event URL

If a user opens `/events/:eventCode` and that event does not exist or cannot be loaded, what should happen?

Options:

- redirect to `/` with an error message
- show an event-not-found page at the same URL
- keep them on the route and show the choose/create event form

Recommendation: redirect to `/` with an error message. The event code is the parent context for every event route, so staying on a broken event route does not buy much.

Answer: Correct redirect with an error message saying event doesn't exist

### 11. Remembered Event Behavior

Today the app remembers the current event locally. With routes, what should `/` do if a remembered event exists?

Options:

- always show Choose/Create Event
- automatically redirect to the remembered event
- show Choose/Create Event with a “Continue Event” option

Recommendation: show Choose/Create Event with a “Continue Event” option. Auto-redirecting from `/` can make it harder to intentionally switch events.

Answer:Don't auto-redirect from `/`, if a user has a saved state, fill in the event code witth that saved event

### 12. Division Filter URL State

Should the Event View division filter be represented in the URL?

Options:

- no, keep it as local UI state only
- yes, use a query param like `/events/STRIVE-BASH?division=AA`

Recommendation: use a query param. It makes filtered Event View links shareable without creating extra routes.

Answer:I like that, make it a query param

### 13. Pool Setup Save Destination

After saving pool setup, where should the app navigate?

Options:

- Event View: `/events/:eventCode`
- Pool View: `/events/:eventCode/pools/:poolId`

Recommendation: Pool View. Saving setup usually means the user is ready to inspect or score that pool, and it matches the direct-linkable pool route.

Answer: Pool view

### 14. Admin Sign-In Location

Should admin sign-in remain a modal/panel inside the shell, or become its own route?

Options:

- shell modal/panel
- route like `/admin`
- query param like `?admin=1`

Recommendation: shell modal/panel. Admin is a permission state, not really a destination, and setup routes can trigger the same sign-in UI when needed.

Answer: keep it shell modal/panel

### 15. Route Guards vs Component Checks

Should admin-only setup access be enforced with Angular route guards, component checks, or both?

Options:

- route guard only
- component check only
- both guard and component check

Recommendation: both. The guard handles navigation cleanly, and the component check prevents accidental setup UI rendering if state changes after navigation.

Answer: Both works for me

### 16. Admin Setup Route Redirect Behavior

If a non-admin opens an admin-only setup route, we want admin sign-in and then continue to the intended setup page. With Angular guards, the cleanest implementation needs one concrete behavior.

For an existing pool setup direct link:

```txt
/events/:eventCode/pools/:poolId/setup
```

For new pool setup:

```txt
/events/:eventCode/new-pool
```

Options:

- allow the setup route to load, but render only the admin sign-in modal until the user signs in
- redirect to the nearest non-admin page, open the admin modal there, then navigate back to the original setup route after sign-in

Recommendation: redirect to the nearest non-admin page, open the admin modal there, then navigate back after sign-in.

That means:

- existing pool setup redirects temporarily to `/events/:eventCode/pools/:poolId`
- new pool setup redirects temporarily to `/events/:eventCode`
- after successful admin sign-in, navigate back to the originally requested setup route

This keeps setup components truly admin-only while still giving the user a smooth sign-in flow.

Answer: Yes that's good
