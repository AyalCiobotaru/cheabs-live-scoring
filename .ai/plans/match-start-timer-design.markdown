# Match Start Timer Design

## Goal

Add a configurable countdown timer that starts when a match is marked final, showing teams how much time remains before the next match should start.

## Codebase Facts

- Pool setup already owns per-pool configuration such as teams, target score, cap, games per match, and schedule.
- Match finalization flows through `MatchRowComponent.markFinal()`, then `PoolViewComponent.finalChanged`, then `ScoringEventStateService.handleFinalChanged(match)`.
- `handleFinalChanged` currently:
  - touches the match timestamp,
  - persists local state,
  - publishes a realtime `match-updated` message,
  - persists the match to the backend.
- Realtime uses Ably with `rewind: '1'` and also has snapshot request/response behavior for late or refreshed browsers.
- Pool setup updates publish whole-pool state. Match updates currently publish only `{ poolId, match }`.

## Hard Pushback

Do not make each browser's local timer the source of truth.

That design fails for:

- browsers opened after the match was completed,
- refreshed scoring devices,
- sleeping mobile browsers,
- websocket reconnects,
- clients that missed the one realtime message,
- devices with slightly different local timer start moments.

The durable source of truth should be a timestamp in event state, not an in-memory browser interval.

## Recommended Shape

Store an absolute deadline:

```ts
interface PoolState {
  matchStartTimerMinutes: number;
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
}
```

When a match is marked final:

```ts
pool.nextMatchStartAt = new Date(Date.now() + pool.matchStartTimerMinutes * 60_000).toISOString();
pool.nextMatchStartSourceMatchId = match.id;
```

Every browser renders:

```ts
remainingMs = Date.parse(pool.nextMatchStartAt) - Date.now();
```

This makes late browsers work because they load the pool state, not the original event message.

## Design Tree

### 1. Timer Scope

Decision needed: Is this timer per pool, per court, or event-wide?

Recommended first version: per pool.

Reasoning: The current app's core unit of live scoring is `PoolState`, and pool setup is where the user wants to configure it. Event-wide timers would introduce cross-pool coordination that does not exist today.

Questions:

- Can two pools be running matches at the same time?
   - Yes
- Does each pool have its own court?
   - Yes
- If one pool finishes a match, should another pool's timer change?
   - No

### 2. Trigger

Decision needed: Does the timer start when a set finishes, or when the match is marked final?

Recommended first version: match final only.

Reasoning: The UI already has an explicit "Mark final" action for the match. Starting on set final would be ambiguous for multi-set matches.

Questions:

- Should the timer start after every match, including the last scheduled match?
   - No timer should not start after the last scheduled match but should start after each other one
- Should it start if a match is marked final with incomplete or unusual scores?
   - Yes
- Should it start when the backend receives the final match, or immediately in the scoring browser before backend confirmation?
   - Whichever is cleaner

### 3. Duration Configuration

Decision needed: What is configurable in pool setup?

Recommended first version:

- `matchStartTimerMinutes`
- integer minutes
- default `0` or `5`, depending on whether the feature should be opt-in
- `0` disables the timer

Questions:

- What is the default break time?
   - Default time should be 10 minutes
- Do tournaments ever need different times between different matches in the same pool?
   - No
- Do admins need seconds-level precision, or are whole minutes enough?
   - No, minutes is enough

### 4. Late Browser Behavior

Decision needed: How should a browser that opens mid-countdown know the timer?

Recommended first version: persist `nextMatchStartAt` in `PoolState`.

Reasoning: The browser can fetch or receive the latest event snapshot, then compute the remaining time locally. No special "timer started" message replay is required.

Questions:

- Should a browser show an expired timer as `Start now`, `0:00`, or hide it?
   - Expired timer should show "Timer expired, Start Match"
- How long after expiration should the expired timer remain visible?
   - Until the first point is scored
- Should a browser opened after expiration still show which match triggered the timer?
   - No

### 5. Reopen Behavior

Decision needed: What happens when a finalized match is reopened?

Recommended first version:

- If `nextMatchStartSourceMatchId === reopenedMatch.id`, clear the timer.
- If another later match already started a newer timer, leave it alone.

Questions:

- If a scorekeeper accidentally marks final, should reopening erase the countdown immediately?
   - Yes
- Should admins get a manual override regardless of source match?
   - Yes

### 6. Multiple Finalizations

Decision needed: What happens when another match is marked final while a timer is active?

Recommended first version: newest final match wins.

Reasoning: The timer is guidance for the next match after the most recent completed match. Keeping older timers around adds state complexity without a clear first-version benefit.

Questions:

- Can matches be scored out of schedule order?
   - Technically yes, but ignore this
- If match 3 is finalized before match 2, which timer should the pool display?
   - Ignore this edge case, assume each match is played in order
- Should the timer derive from schedule order instead of finalization time?
   - No, timer should be finalization time

### 7. Realtime Payload

Decision needed: Should timer updates travel in match updates or pool setup updates?

Recommended first version: publish a pool-level update when timer fields change.

Reasoning: The timer belongs to the pool, not the match. Current match realtime messages only carry a match, so late clients need the persisted pool state anyway.

Implementation option:

- `handleFinalChanged` updates `pool.nextMatchStartAt`.
- Persist the match and pool timer fields together if possible.
- Publish either:
  - a whole pool setup update, or
  - a new realtime message kind such as `pool-timer-updated`.

Questions:

- Should timer changes be saved through the existing pool endpoint or a new focused endpoint?
   - Existing endpoint
- Is it acceptable for `match-updated` to also carry timer metadata?
   - yes
- Do we want to avoid publishing full pool setup because it can include non-score setup changes?
   - yes

### 8. Display Locations

Decision needed: Where does the timer show?

Recommended first version:

- Pool view header or pool summary.
- Event dashboard pool cards can be added after the first pass.

Questions:

- Is the timer for scorekeepers, teams, spectators, or all of them?
   - All
- Should it be visible while editing pool setup?
   - No, only how long should be between matches
- Should it be visually prominent enough to read from across a court?
   - Have a screen that the scorer could go to that just shows the timer counting down so it can be seen from the court

### 9. Authority and Editing

Decision needed: Who can configure and control the timer?

Recommended first version:

- Admin configures duration in pool setup.
- Scorekeeper starts it implicitly by marking match final.
- Admin can clear/reset later if needed, but manual controls can wait unless required.

Questions:

- Can non-admin scorekeepers mark matches final today?
   - yes
- Should a non-admin finalization be allowed to start a timer?
   - yes
- Do admins need pause, resume, clear, or restart controls in version one?
   - no

### 10. Clock Correctness

Decision needed: Is client clock drift acceptable?

Recommended first version: acceptable.

Reasoning: This is an operational display timer, not payment, locking, or eligibility enforcement. Absolute ISO timestamps are good enough.

Questions:

- Is a 5-10 second difference between devices acceptable?
   - Yes
- If not, should the backend return server time with event state so clients can compute an offset?
   - N/A

## Proposed Version One

1. Add timer fields to `PoolState`:
   - `matchStartTimerMinutes: number`
   - `nextMatchStartAt: string | null`
   - `nextMatchStartSourceMatchId: string | null`
2. Add a pool setup input for timer minutes.
3. On match final:
   - if duration is greater than `0`, set `nextMatchStartAt`,
   - set source match id,
   - persist and publish the timer state.
4. On match reopen:
   - clear timer only if the reopened match started the current timer.
5. Display countdown from `nextMatchStartAt`.
6. If expired:
   - show `Start next match` until cleared or replaced.

## Open Questions To Resolve Next

1. What should the default timer duration be? 10 minutes
2. Should `0` mean disabled? yes
3. Should the timer appear on pool view only, or also event dashboard? also event dashboard
4. Should a timer start after the final scheduled match in the pool? no
5. Should the newest finalized match always replace the active timer? this shouldn't happen but if this edge case is needed, then yes
6. Do admins need manual clear/reset in the first version? no
7. Should timer persistence be a new endpoint, a pool update, or folded into match final persistence? folded into match final persistence

## First Decision To Make

Before implementation, decide timer scope:

**Is the timer per pool, per court, or event-wide?**

My recommendation is per pool because that matches the existing state model and setup workflow.

## Grill-Me Pass 2

Your answers resolve these decisions:

- Scope: per pool.
- Courts: each pool has its own court.
- Trigger: match final, not set final.
- Last scheduled match: no timer.
- Default duration: 10 minutes.
- Precision: whole minutes.
- Disabled state: `0` minutes.
- Expired display: `Timer expired, Start Match`.
- Expired visibility: stays visible until the first point is scored.
- Reopen: clears the timer if the reopened match started it.
- Manual admin clear/reset: not needed in version one.
- Realtime/persistence preference: folded into match final persistence; avoid full pool setup publish.
- Dashboard: timer status should appear there too.
- Timer-only view: desired for court-visible display.
- Clock drift: acceptable.

### New Pushback 1: Source Match Is Not Enough

The current proposed fields track which match started the timer:

```ts
nextMatchStartSourceMatchId: string | null;
```

That is enough for reopen behavior, but it is not enough for your "hide expired timer after the first point is scored" rule.

We need to know which match's first point clears the timer.

Options:

1. Derive the target match from schedule order every time.
   - If match 1 starts the timer, match 2 is the target.
   - Risk: if schedule rows are edited/reordered after the timer starts, the target can change accidentally.
2. Store the target match id at timer creation.
   - Add `nextMatchStartTargetMatchId: string | null`.
   - The timer clears when that target match receives its first score change.
   - More explicit and safer.
3. Clear on first point in any later unfinalized match.
   - Simpler.
   - Risk: the wrong match can clear the display if someone scores out of order.

Recommendation: add `nextMatchStartTargetMatchId`.

Question:

- Should the timer clear only when the scheduled next match gets its first point, or when any match in the pool gets its first point?
   - Yes once ANY match starts scoring the timer should get cleared, don't store `nextMatchStartTargetMatchId` 

### New Pushback 2: "Last Scheduled Match" Needs a Definition

You said no timer after the last scheduled match. That means finalization needs to know whether the finalized match has a next scheduled match.

Options:

1. Use array order in `pool.matches`.
   - Last match is `pool.matches[pool.matches.length - 1]`.
   - This matches the existing schedule UI.
2. Use "next unfinalized match" after the finalized match.
   - If match 2 is already final and match 1 gets finalized late, the timer might target match 3.
   - More complex and probably not what you want.

Recommendation: use array order and ignore out-of-order edge cases, matching your earlier answers.

Question:

- Confirm: "last scheduled match" means the last row in the pool's schedule array, even if matches were scored out of order? Correct, use array order in pool.matches

### New Pushback 3: Existing Endpoint Is Ambiguous

You answered:

- timer changes should use the existing endpoint,
- timer persistence should be folded into match final persistence,
- `match-updated` may carry timer metadata,
- avoid full pool setup publish.

That points to a focused extension of the existing match update flow:

```ts
PUT /api/scoring/events/:eventCode/pools/:poolId/matches/:matchId
```

Payload shape could become:

```ts
{
  match,
  timer?: {
    nextMatchStartAt: string | null;
    nextMatchStartSourceMatchId: string | null;
    nextMatchStartTargetMatchId: string | null;
  }
}
```

Realtime shape could become:

```ts
{
  kind: 'match-updated',
  poolId,
  match,
  timer
}
```

Risk: this makes `match-updated` mutate both a match and pool-level timer fields. That is acceptable if we name the helper carefully and treat timer as part of the match-final side effect.

Question:

- Are you comfortable with `match-updated` carrying pool timer fields, or do you want a separate `pool-timer-updated` realtime message while still using the existing backend endpoint?
   - What is your suggestion based on my previous responses?

### New Pushback 4: Timer-Only Screen Is Version-One Scope Creep

You asked for a screen the scorer can open that only shows the timer and is visible from the court.

The app can support this naturally with a route such as:

```txt
/events/:eventCode/pools/:poolId/timer
```

But this is a different UI surface than adding timer status to pool summary/dashboard.

Version-one options:

1. Compact timer in pool summary and dashboard only.
2. Compact timer plus a "timer display" route.
3. Timer display route only, linked from pool view.

Recommendation: include both compact display and timer route in version one if the court-visible use case matters. Otherwise the feature will technically work but fail the real-world visibility need.

Questions:

- Should the timer route be public to anyone with the event link?
- Should the timer route include pool/event names, or literally only the large countdown/status?
   - Literally just a LARGE countdown/status
- How should a scorer open it: button in pool view, button on dashboard card, or both?
   - Button on the dashboard card or in the pool summary, whichever is easier


### New Pushback 5: Expiration Text Needs States

You chose:

- while active: countdown.
- after expiration: `Timer expired, Start Match`.
- hide after first point is scored.

That creates these display states:

1. Timer disabled: show nothing.
2. No active timer: show nothing.
3. Active timer before deadline: show countdown.
4. Active timer after deadline, before first target point: show `Timer expired, Start Match`.
5. Cleared after first target point: show nothing.

Question:

- Should `Timer expired, Start Match` appear on the dashboard card too, or only on pool/timer views?
   - Should show on dashboard card too

### Updated Proposed Data Shape

If you accept the target-match pushback:

```ts
interface PoolState {
  matchStartTimerMinutes: number;
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
  nextMatchStartTargetMatchId: string | null;
}
```

### Next Questions To Answer

1. Should the timer clear only when the scheduled next match gets its first point, or any match gets its first point?
2. Confirm last scheduled match means last row in `pool.matches`.
3. Use `match-updated` with timer metadata, or add separate `pool-timer-updated` realtime message?
4. Is the timer-only route in version one?
5. Is the timer-only route public to anyone with the event link?
6. Should the timer-only route show event/pool names, or only the large timer/status?
7. Where should users open the timer route from? 
8. Should expired timer status appear on dashboard cards?

## Grill-Me Pass 3

Your latest answers settle more branches:

- Timer clears when any match in the pool receives its first score after the timer starts.
- Do not store `nextMatchStartTargetMatchId`.
- Last scheduled match means the last row in `pool.matches`.
- Timer-only route should show literally just a large countdown/status.
- Timer route should be linked from whichever existing summary/card surface is easiest.
- Expired timer status should show on dashboard cards too.

### Recommendation On Realtime Payload

You asked for my suggestion based on your previous answers.

I recommend a separate realtime message kind:

```ts
{
  kind: 'pool-timer-updated',
  poolId,
  timer: {
    nextMatchStartAt: string | null;
    nextMatchStartSourceMatchId: string | null;
  }
}
```

But I still recommend persisting it through the existing match-final backend endpoint.

Reasoning:

- Your product model says the timer belongs to the pool, not the match.
- Your persistence preference says the timer side effect belongs to match finalization.
- Your realtime preference says avoid full pool setup publishes.
- A separate realtime message keeps remote apply code explicit: match updates update matches; timer updates update pool timer fields.
- Late joiners are still covered because the timer is persisted in `PoolState`.

Rejected option:

```ts
{
  kind: 'match-updated',
  poolId,
  match,
  timer
}
```

This is workable, but it creates a hidden coupling: a message named `match-updated` also mutates pool-level timer state. That is easy to forget later when another feature listens to match updates.

Recommended backend flow:

1. Client marks match final.
2. Client computes local timer fields immediately for fast UI response.
3. Client sends the match update request with timer intent.
4. Server sanitizes and persists both the match and pool timer fields.
5. Server publishes:
   - `match-updated`
   - `pool-timer-updated`

Potential refinement:

- The server should probably compute `nextMatchStartAt` using server time, not trust the client timestamp.
- Since 5-10 second drift is acceptable, this is not required for correctness, but it makes the persisted deadline consistent.

Question:

- Do you accept `pool-timer-updated` as a separate realtime message while still folding persistence into the match-final endpoint?
   - yes

### New Pushback 1: Clearing On Any Score Needs A Guard

You said any match scoring should clear the timer.

That is simple, but without a guard it can clear too aggressively:

- A scorekeeper fixes a score on the just-finished match after final/reopen confusion.
- A scorekeeper edits an older match.
- A score event arrives from another browser with stale state.

Because you already chose to ignore out-of-order play, the simple rule can still be acceptable, but it should mean:

```txt
If a pool has an active/expired timer, clear it when any match in that pool changes from no score to some score after the timer was started.
```

This implies we need to detect "first point" rather than every score change.

Recommended helper:

```ts
hasAnyScore(match): boolean
```

And clear only when:

- `pool.nextMatchStartAt != null`
- the match being scored was previously scoreless
- the new match state has any score

Question:

- Should editing a match that already had scores leave the timer alone? My recommendation: yes.

### New Pushback 2: Timer Route Publicness Is Still Unanswered

You answered what the timer-only route shows, but not who can open it.

The current pool route is public to anyone with the event link. Admin-only is reserved for setup routes.

Recommendation: timer route should be public.
   - Yes timer should be public

Reasoning: the timer is for teams/spectators too, and the court display should not need admin access.

Question:

- Confirm the timer-only route is public to anyone with the event link.

### New Pushback 3: "Literally Just A Large Countdown" Still Needs Empty States

A display-only route cannot be blank when no timer is active, or scorers will think the route is broken.

Recommended timer-only states:

1. Timer running:
   - `6:42`
2. Timer expired:
   - `Timer expired, Start Match`
3. No active timer:
   - `No active timer`
4. Timer disabled for pool:
   - `Timer disabled`

Question:

- Are `No active timer` and `Timer disabled` acceptable on the timer-only screen?
   - Yes

### New Pushback 4: The Timer Button Can Be In Pool Summary, But That Has A Click Trap

Dashboard pool cards are clickable. If we put a timer-display button inside the `PoolSummaryComponent`, clicking it from the dashboard card may also trigger the card's pool selection unless the click event is stopped.

Options:

1. Put the timer button outside `PoolSummaryComponent` in each parent.
   - More duplicated UI.
   - Easier event handling.
2. Put it inside `PoolSummaryComponent` and emit a `timerSelected` event.
   - Reusable.
   - Parent dashboard must stop propagation around the button.
3. Do not add a button; make the timer status itself clickable.
   - Fewer controls.
   - Less obvious.

Recommendation: add a small explicit timer-display button wherever timer status appears. Use an event output from `PoolSummaryComponent`.

Question:

- Should the timer display button always show, or only while a timer is active/expired? My recommendation: always show when timer duration is greater than `0`, because the route has useful empty states.
   - Yes agreed

### New Pushback 5: Setup Needs A Label That Matches Behavior

The setup field should not be ambiguous.

Bad label:

```txt
Timer
```

Better labels:

```txt
Minutes between matches
```

or

```txt
Next match timer
```

Recommendation:

- Use `Minutes between matches`.
- Helper text is probably unnecessary if `0` is clear in the control, but the disabled behavior needs some affordance.

Question:

- Should the setup UI say that `0` disables the timer, or should `0` be avoided with a separate enable/disable control?
   - `Minutes between matches` is good and `0` should disable 

### Updated Version-One Shape

Data:

```ts
interface PoolState {
  matchStartTimerMinutes: number;
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
}
```

Behavior:

- Default `matchStartTimerMinutes` is `7`.
- `0` disables timer.
- Timer starts when a non-last match is marked final.
- Timer does not start for the last row in `pool.matches`.
- Reopening the source match clears the timer.
- Any first score in the pool after timer start clears the timer.
- Dashboard and pool summary show running/expired timer status.
- Timer-only route shows large countdown/status.
- Timer state is persisted with match finalization.
- Realtime uses `pool-timer-updated`.

### Next Questions To Answer

1. Accept separate `pool-timer-updated` realtime message?
2. Should editing a match that already had scores leave the timer alone?
3. Confirm timer-only route is public to anyone with the event link.
4. Are `No active timer` and `Timer disabled` acceptable timer-only empty states?
5. Should the timer display button always show when timer duration is greater than `0`?
6. Should setup use `0` disables timer, or a separate enable/disable control?

## Grill-Me Pass 4

Your latest answers resolve these:

- Use a separate `pool-timer-updated` realtime message.
- Persist timer changes through the match-final endpoint.
- Timer-only route is public.
- Timer-only empty states are acceptable:
  - `No active timer`
  - `Timer disabled`
- Timer display button should always show when `matchStartTimerMinutes > 0`.
- Pool setup uses `Minutes between matches`.
- `0` disables the timer.

One important question from Pass 3 is still unresolved:

- Should editing a match that already had scores leave the timer alone?

My recommendation remains yes.

### New Pushback 1: "Any Match Starts Scoring" Needs A Timestamp Boundary

You chose: any match scoring clears the timer.

The word "starts" matters. We should not clear the timer because an old match with existing scores gets edited.

Recommended rule:

```txt
Clear the timer when a score update changes a match from scoreless to scored while `pool.nextMatchStartAt` is set.
```

This avoids needing `nextMatchStartTargetMatchId` and still keeps the behavior aligned with your simple mental model.

Implementation implication:

- Before applying `setScore` or `updateScore`, compute whether the match was scoreless.
- After the score change, compute whether it has any score.
- If it moved from scoreless to scored, clear timer fields.

Question:

- Confirm: edits to a match that already has any score should not clear or affect the timer.
   - Sure

### New Pushback 2: Timer Clear Must Persist And Broadcast Too

Starting the timer is not the only timer mutation. Clearing it after first score also needs to:

- update local pool state,
- persist backend event state,
- broadcast `pool-timer-updated`,
- reach dashboard cards and timer-only screens.

This means score updates may now need to persist pool timer fields, not only match scores.

Options:

1. Extend score/match update persistence to include timer clear.
   - Same endpoint as match update.
   - Consistent with match-final timer start.
2. Add a separate timer-clear endpoint.
   - Cleaner resource boundary.
   - More backend surface area.
3. Only clear locally/realtime and wait for next full pool save.
   - Bad. Late joiners would see stale expired timer.

Recommendation: use option 1. Match score update endpoint persists both the match and any timer clear side effect.

Question:

- Accept that score updates can also carry timer-clear intent through the existing match endpoint?
   - Yes that will work

### New Pushback 3: Timer Start Should Be Server-Computed

Earlier you said "whichever is cleaner" for whether the timer starts on backend receipt or immediately in the browser.

Given the accepted persistence shape, the cleanest reliable model is:

- Browser updates optimistically for immediate UI.
- Server computes the authoritative `nextMatchStartAt` when the match-final request arrives.
- Server publishes `pool-timer-updated`.
- Clients reconcile to server timestamp.

This keeps late joiners correct and avoids trusting client clocks for persisted state, while still feeling instant for the scoring browser.

Question:

- Accept optimistic client display plus server-authoritative persisted deadline?
   - Yes, accepted

### New Pushback 4: Reopen Needs To Clear Persistently

You said reopening the source match clears the timer.

That means reopen is not just a match update either. It can mutate pool timer fields:

```txt
If reopened match id equals `nextMatchStartSourceMatchId`, clear timer fields.
```

Recommended behavior:

- Clear timer locally immediately.
- Persist reopen and timer clear through the existing match endpoint.
- Publish `match-updated` and `pool-timer-updated`.

Question:

- Confirm reopen of a non-source match should leave the timer alone.
   - Confirmed

### New Pushback 5: Timer Route With Literally Only Status Still Needs Accessibility

You want the route to show literally just a large countdown/status. That is fine visually, but the text still needs to be meaningful to assistive tech and browser title users.

Recommendation:

- Visual page: only large status text.
- Document title: include event/pool context, e.g. `Pool A Timer`.
- Accessible label: include context in `aria-label`, not visible text.

Question:

- Is hidden/accessibility-only context acceptable even though the visible page is only the timer/status?
   - yes

### New Pushback 6: Dashboard Timer Button Placement

You said dashboard card or pool summary, whichever is easier.

Given the existing app, easiest implementation is likely:

- Add timer status and timer button to `PoolSummaryComponent`.
- Add an output event, e.g. `timerSelected`.
- In dashboard card, stop event propagation when the timer button is clicked.
- In pool view, route directly to the timer screen.

Question:

- Accept placing the timer button inside `PoolSummaryComponent` even though the dashboard parent must stop click propagation?
   - Yes, accepted

### Implementation-Ready Spec Draft

Data:

```ts
interface PoolState {
  matchStartTimerMinutes: number;
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
}
```

Setup:

- Add numeric input labeled `Minutes between matches`.
- Default `7`.
- Clamp to whole minutes.
- `0` disables timer.

Timer start:

- Triggered when a match is marked final.
- Does not start if the match is the last row in `pool.matches`.
- Does not start if `matchStartTimerMinutes === 0`.
- Server computes authoritative deadline.

Timer clear:

- Reopening source match clears timer.
- First score in any scoreless match clears timer.
- Editing a match that already had scores should not affect timer if confirmed.

Realtime:

- Keep `match-updated` for match changes.
- Add `pool-timer-updated` for timer fields.
- Late joiners get timer fields through persisted `PoolState` snapshots.

Display:

- Pool summary/dashboard show countdown or expired status.
- Timer display button appears when `matchStartTimerMinutes > 0`.
- Timer-only route:
  - public,
  - visually only large countdown/status,
  - states: running, expired, no active timer, disabled.

### Next Questions To Answer

1. Confirm edits to a match that already has scores should not affect timer.
2. Accept score updates carrying timer-clear intent through the existing match endpoint?
3. Accept optimistic client display plus server-authoritative persisted deadline?
4. Confirm reopen of a non-source match leaves timer alone.
5. Allow hidden/accessibility-only context on the timer-only route?
6. Accept timer button inside `PoolSummaryComponent` with dashboard click propagation handled by the parent?

## Grill-Me Pass 5

All Pass 4 questions are now resolved:

- Edits to matches that already have scores do not affect the timer.
- Score updates can carry timer-clear intent through the existing match endpoint.
- Timer starts optimistically in the browser, then reconciles to a server-authoritative deadline.
- Reopening a non-source match leaves timer state alone.
- Hidden/accessibility-only route context is acceptable.
- Timer button can live inside `PoolSummaryComponent`.

At this point the feature is mostly implementation-ready. The remaining questions are lower-level failure modes and naming choices.

### Final Pushback 1: We Need A Timer Mutation Contract

Timer fields should only change through a small set of explicit actions. Otherwise this will sprawl across score handling, match final handling, reopen handling, remote merge, and backend sanitization.

Recommended timer mutation contract:

```ts
type PoolTimerUpdate = {
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
};
```

Allowed mutations:

1. `start`
   - finalizing a non-last match when `matchStartTimerMinutes > 0`
   - sets deadline and source match id
2. `clear`
   - reopening the source match
   - first score in any scoreless match while timer is active
   - clearing fields to `null`
3. `configure`
   - pool setup changes `matchStartTimerMinutes`
   - if changed to `0`, clear active timer
   - if changed while active and non-zero, leave current timer deadline alone

Recommendation: do not recalculate an already-running timer when the admin changes `Minutes between matches`. The config applies to the next timer.

Question:

- If `Minutes between matches` is changed while a timer is already running, should the current timer keep its original deadline?
   - nope

### Final Pushback 2: What Happens If Duration Is Set To 0 While A Timer Is Active?

This one should be explicit.

Recommendation:

- Setting `matchStartTimerMinutes` to `0` clears any active timer immediately.

Reasoning:

- `0` means disabled.
- A disabled timer still displaying would be confusing.

Question:

- Confirm setting `Minutes between matches` to `0` should clear the current timer immediately.
   - Yes confirmed

### Final Pushback 3: Failed Persistence After Optimistic Timer Start

The client will show the timer immediately after finalization, but the backend request can fail.

Options:

1. Leave optimistic timer running and show existing error state.
   - Simple.
   - Risk: browser may show a timer that was not persisted.
2. Roll back timer if match final persistence fails.
   - More correct.
   - Requires storing previous timer state.
3. Re-fetch event on failure.
   - Most reliable.
   - More network and implementation work.

Recommendation: leave existing error handling for version one, but do not overpromise persistence in the UI. The next successful snapshot/update will reconcile state.

Question:

- Is it acceptable in version one that a failed match-final save could temporarily leave the local optimistic timer visible until a refresh/snapshot corrects it?
   - Yes

### Final Pushback 4: Timer-Only Route Needs Refresh Ticks

The timer route and summary displays need local ticking even though the source of truth is a timestamp.

Recommendation:

- Use a lightweight interval in the display component/service, probably every second.
- The interval only updates the rendered "now"; it does not mutate pool state.
- Clear interval on destroy.

Question:

- Should the compact dashboard/pool summary tick every second too, or is minute-level display enough there?
   - Use the recommendation below

Recommendation:

- Timer-only route: every second.
- Dashboard/pool summary: every second while timer is under 10 minutes, because a stale dashboard countdown looks broken.

### Final Pushback 5: Display Format

We need exact display copy.

Recommended compact display:

```txt
Next match in 6:42
Timer expired, Start Match
```

Recommended timer-only route:

```txt
6:42
Timer expired, Start Match
No active timer
Timer disabled
```

Question:

- Accept this exact display text?
   - Yes

### Final Pushback 6: Backend Sanitization Defaults

Existing events will not have timer fields.

Recommended defaults during normalization:

```ts
matchStartTimerMinutes: 10
nextMatchStartAt: null
nextMatchStartSourceMatchId: null
```

Question:

- Confirm existing pools should automatically get a 10-minute timer default after this feature ships.

### Final Implementation Spec

Data:

```ts
interface PoolState {
  matchStartTimerMinutes: number;
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
}
```

Realtime:

```ts
type RealtimeSnapshot =
  | ExistingRealtimeKinds
  | {
      kind: 'pool-timer-updated';
      poolId: string;
      timer: PoolTimerUpdate;
    };
```

Backend:

- Existing match endpoint persists match changes.
- Existing match endpoint also accepts timer mutation intent for start/clear cases.
- Server computes authoritative start deadline.
- Server publishes `match-updated`.
- Server publishes `pool-timer-updated` when timer fields change.

Frontend:

- Pool setup adds `Minutes between matches`.
- Pool summary shows compact timer state and a timer-display button when duration is greater than `0`.
- Dashboard gets timer status through reused pool summary.
- Timer route:
  - `/events/:eventCode/pools/:poolId/timer`
  - public
  - visually large timer/status only
  - hidden/accessibility context allowed
- First score in a scoreless match clears active timer.
- Reopen source match clears active timer.

### Final Questions Before Implementation

1. If duration changes while a timer is running, keep the current deadline?
2. If duration changes to `0`, clear current timer immediately?
3. Is temporary optimistic timer drift on failed save acceptable for version one?
4. Should compact summary/dashboard countdown tick every second?
5. Accept the proposed exact display text? Yes
6. Should existing pools default to 10 minutes? Yes

## Grill-Me Pass 6

Your latest answers resolve these:

- Setting `Minutes between matches` to `0` clears the current timer immediately.
- Temporary optimistic timer drift on failed save is acceptable for version one.
- Timer-only route ticks every second.
- Dashboard/pool summary also ticks every second while timer is under 10 minutes.
- Display text is accepted:
  - `Next match in 6:42`
  - `Timer expired, Start Match`
  - `No active timer`
  - `Timer disabled`
- Existing pools default to a 10-minute timer.

One answer changes the timer configuration contract:

- If `Minutes between matches` changes while a timer is running, you answered "nope" to keeping the current deadline.

That means changing duration while a timer is active must update the active timer somehow. There are two viable interpretations.

### Final Pushback: Recalculate From Which Time?

If an active timer started at 10:00 with 10 minutes, it expires at 10:10.

At 10:03, admin changes `Minutes between matches` to 5.

Should the new deadline be:

1. `10:05`, recalculated from the original timer start.
   - New deadline = source match final time + new duration.
   - This preserves the meaning of "minutes between matches."
   - Requires storing the timer start time or deriving it from source match `updatedAt`.
2. `10:08`, recalculated from now.
   - New deadline = current time + new duration.
   - This acts like "restart timer with new duration."
   - Easier, but changing from 7 to 5 at minute 3 makes the wait 8 total minutes, which is probably not what people expect.
3. Clear timer and let the next match/finalization start the new behavior.
   - Simple.
   - But it conflicts with your "nope" answer if you expected the visible timer to adjust.

Recommendation: option 1, recalculate from original timer start.

To do that cleanly, add one more field:

```ts
nextMatchStartTimerStartedAt: string | null;
```

Then active timer changes can be recalculated as:

```ts
nextMatchStartAt = nextMatchStartTimerStartedAt + matchStartTimerMinutes;
```

Updated data shape would become:

```ts
interface PoolState {
  matchStartTimerMinutes: number;
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
  nextMatchStartTimerStartedAt: string | null;
}
```

Question:

- When duration changes while a timer is active, should the deadline recalculate from the original timer start time?
   - Sorry I meant no it should NOT recalculate.

### Related Pushback: Server-Computed Start Needs StartedAt Anyway

We already accepted server-authoritative start deadlines. If the server computes:

```ts
startedAt = now
nextMatchStartAt = now + duration
```

then storing `nextMatchStartTimerStartedAt` is straightforward and makes later duration changes deterministic.

It also gives us a better audit trail than only storing source match id.

Question:

- Accept adding `nextMatchStartTimerStartedAt` to `PoolState`?

### Updated Timer Mutation Contract

If the above is accepted:

Allowed mutations:

1. `start`
   - set `nextMatchStartTimerStartedAt`
   - set `nextMatchStartAt`
   - set `nextMatchStartSourceMatchId`
2. `clear`
   - clear all three active timer fields
3. `configure`
   - if new duration is `0`, clear active timer
   - if timer is active and new duration is greater than `0`, recompute `nextMatchStartAt` from `nextMatchStartTimerStartedAt`
   - if no timer is active, only update config

### Remaining Questions

1. When duration changes while active, recalculate from original timer start time?
2. Accept adding `nextMatchStartTimerStartedAt`? No

## Final Consolidated Spec

This section supersedes the exploratory grill-me passes above.

### Decisions

- Timer scope is per pool.
- Each pool has its own court.
- Timer starts when a match is marked final, not when a set is marked final.
- Timer does not start after the last scheduled match.
- "Last scheduled match" means the last row in `pool.matches`.
- Timer start is based on finalization time.
- Timer duration defaults to `7` minutes.
- Timer duration uses whole minutes.
- `0` disables the timer.
- Existing pools default to a 10-minute timer after this feature ships.
- Timer is visible on pool view and event dashboard.
- Timer-only display route is included in version one.
- Timer-only display route is public to anyone with the event link.
- Timer-only display route visually shows only a large countdown/status.
- Hidden/accessibility-only context is acceptable on the timer route.
- Non-admin scorekeepers can start timers by marking matches final.
- No pause/resume/manual reset controls in version one.
- Client clock drift of 5-10 seconds is acceptable.

### Data Shape

```ts
interface PoolState {
  matchStartTimerMinutes: number;
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
}
```

No `nextMatchStartTargetMatchId`.

No `nextMatchStartTimerStartedAt`.

### Setup Behavior

- Pool setup adds a numeric field labeled `Minutes between matches`.
- Default value is `7`.
- Values are clamped to whole minutes.
- `0` disables the timer.
- If duration changes while a timer is active and the new value is greater than `0`, the active timer keeps its current deadline.
- If duration changes to `0`, the active timer clears immediately.
- Non-zero duration changes apply to future timers only.

### Timer Start Behavior

Timer starts when:

- a match is marked final,
- the match is not the last row in `pool.matches`,
- `matchStartTimerMinutes > 0`.

Timer does not start when:

- the finalized match is the last scheduled match,
- the pool timer duration is `0`.

Flow:

1. Browser starts timer optimistically for immediate UI response.
2. Existing match endpoint persists the final match update and timer start intent.
3. Server computes authoritative `nextMatchStartAt`.
4. Server persists timer fields in `PoolState`.
5. Server publishes `match-updated`.
6. Server publishes `pool-timer-updated`.
7. Clients reconcile to the server-authoritative deadline.

Temporary optimistic drift after a failed save is acceptable for version one.

### Timer Clear Behavior

Timer clears when:

- the source match is reopened,
- any match's `Keep Score` is pressed while a timer is active,
- `Minutes between matches` is changed to `0`.

Timer does not clear when:

- a non-source match is reopened,
- a match score is edited,
- a non-zero duration is changed while a timer is active.

Match expansion can carry timer-clear intent through the existing match endpoint.

### Realtime Behavior

Use a separate realtime message for timer fields:

```ts
type PoolTimerUpdate = {
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
};
```

```ts
{
  kind: 'pool-timer-updated',
  poolId: string,
  timer: PoolTimerUpdate
}
```

Keep `match-updated` focused on match changes.

Late joiners receive timer state through persisted `PoolState` snapshots.

### Display Behavior

Compact pool summary/dashboard display:

```txt
Next match in 6:42
Timer expired, Start Match
```

Timer-only route display:

```txt
6:42
Timer expired, Start Match
No active timer
Timer disabled
```

Timer button:

- Lives inside `PoolSummaryComponent`.
- Shows when `matchStartTimerMinutes > 0`.
- Emits an event such as `timerSelected`.
- Dashboard parent stops click propagation so the pool card does not also open.

Ticks:

- Timer-only route ticks every second.
- Dashboard/pool summary ticks every second while the timer is under 10 minutes.
- Ticking updates rendered time only; it does not mutate pool state.

Route:

```txt
/events/:eventCode/pools/:poolId/timer
```

### Implementation Notes

- Add timer fields to frontend and backend pool normalization.
- Existing persisted pools missing timer fields normalize to:

```ts
matchStartTimerMinutes: 10
nextMatchStartAt: null
nextMatchStartSourceMatchId: null
```

- Clear timer when `Keep Score` expands any match while a timer is active.
- Add `pool-timer-updated` handling to realtime service and event state service.
- Add timer route and display component.
- Add timer status/button to `PoolSummaryComponent`.
