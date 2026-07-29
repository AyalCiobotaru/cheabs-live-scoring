# Editable Pools Design Tree

## Goal

Add a per-pool `editable` setting. Pools are editable by default. When a pool is not editable, users can view pool data but cannot enter or change scores.

## Current Behavior From Code

- `hidden` controls visibility to non-admin users.
- Hidden pools require admin credentials for match updates.
- Visible pools can receive match updates without admin credentials.
- Score entry controls live in `MatchRowComponent`.
- Match persistence is enforced in both frontend and backend paths.

## Design Questions

1. Does `editable = false` block admins too, or only public scorers? only public scorers
2. Should non-editable pools still allow expanding match cards, or should `Keep Score` become a disabled/view-only affordance? do not expand
3. Should reopening a finalized match be blocked when non-editable? yes
4. Should timer side effects be blocked when non-editable, including clearing a timer when a match is opened? yes
5. Should setup edits remain allowed while a pool is non-editable? yes
6. Should bulk seeded import create pools as editable by default? yes
7. Should event CSV import create pools as editable by default? yes
8. Should public realtime clients immediately stop editing when an admin unchecks editable? no
9. Should the backend reject score writes for non-editable pools, or only the UI disable controls? yes
10. Should attempted blocked writes return 403 with a specific error message? yes

## Recommended Defaults

- `editable` defaults to `true` everywhere.
- Admins can toggle `editable` in setup.
- `editable = false` blocks public scoring changes and match finalization.
- Backend rejects public match writes when `editable = false`.
- Admin writes can still score/edit if explicitly signed in, because an admin may need emergency correction.
- Setup changes remain admin-only and unaffected by `editable`.

## Resolved Decisions

- `editable = false` blocks only public scorers. Admins remain able to score and correct matches.
- Public users should not be able to expand match cards when a pool is not editable.
- Public users should not be able to reopen finalized games or matches when a pool is not editable.
- Public users should not trigger timer side effects when a pool is not editable.
- Setup edits remain admin-only and are allowed regardless of `editable`.
- Manual pools, seeded import pools, and CSV import pools default to `editable = true`.
- Backend enforcement is required. UI disabling is not sufficient.
- Blocked public score writes should return `403`.

## Remaining Design Pressure

1. Realtime contradiction: public clients should not immediately stop editing when an admin unchecks editable, but the backend should reject writes once `editable = false`.
   - This means a public client may still see enabled controls until its next refresh or pool update, then get a failed save.
   - Recommended resolution: publish the pool setup update immediately and let clients disable controls as soon as they receive it. This is simpler and avoids a bad live-scoring failure path.
2. Admin scoring visibility: when an admin scores a non-editable pool, public viewers should still receive the updated scores.
   - Recommended resolution: yes, admin score writes should publish normally.
3. UI language: decide whether the checkbox label is `Editable`, `Allow scoring`, or `Public scoring enabled`.
   - Recommended resolution: use `Allow scoring`; it describes the effect more clearly than an abstract `Editable`.
4. Public locked state: decide whether to show a small message on locked pools.
   - Recommended resolution: show `Scoring is closed for this pool.` near the schedule/matches.
    Use a locked icon instead of a text, everything else looks good for recommendations