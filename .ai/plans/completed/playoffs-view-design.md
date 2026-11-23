# Playoffs View Design

## Goal

Add a separately navigable playoffs view for each event. Playoffs are organized per category and division, remain hidden from public users until an admin publishes them, support live scoring, automatically advance winners, and allow admins to correct bracket structure and participants.

Design interview status: V1 decisions complete and ready for implementation planning. Phase 2 items remain explicitly deferred.

Implementation status: V1 implemented on `feature/playoff-brackets`; deferred Phase 2 items remain out of scope.

## Confirmed requirements

- Playoffs use a separate view from pool play.
- The public cannot see playoffs until an admin explicitly publishes them.
- Each category + division has its own playoff bracket. This qualifier is necessary because the current data model allows the same division name under Women, Men, Coed, and RevCo.
- Every playoff match supports live scoring.
- Winners normally advance automatically.
- Admins can edit playoff match setup.
- Admins can manually correct the bracket for mistakes and last-minute changes.
- Pool-play tiebreaking must be resolved as part of playoff seeding.

## Current application constraints discovered

- `EventState` currently stores only pools; there is no event-level playoff or bracket model.
- A pool owns its own teams and uses pool-local numeric seeds. A playoff participant therefore needs a stable identity beyond a pool-local seed.
- Pool standings currently count and sort set wins, set losses, point differential, and head-to-head set wins. The tournament uses independent sets as results, so the USAV sequence must be adapted rather than applied as a best-of-match algorithm.
- Existing `hidden` and `editable` behavior is per pool. Playoffs need equivalent server-enforced visibility and scoring permissions, probably per category + division bracket.
- Existing match realtime messages are scoped to `poolId`. Playoff scoring and winner advancement need a separate persisted/realtime scope or a generalized competition-stage scope.

## USA Volleyball tiebreak research

Primary sources reviewed:

- [USA Volleyball 2026 Tie Breaking Procedure Chart](https://usavolleyball.org/events/tournament-director-forms-and-information/)
- [2025-26 USAV Opens Championship Manual](https://usavolleyball.org/wp-content/uploads/2026/01/25-26-USAV-Opens-Championship-Manual-FINAL.pdf), pages 28-29
- [2026 Girls Championship Manual](https://usavolleyball.org/wp-content/uploads/2025/11/2026-Girls-Championship-Manual-Jan_27_2026.pdf), pages 28-30

### Adult Opens procedure relevant to this app

1. Rank teams by **match record**, not total sets won.
2. A two-team tie in match record is always broken head-to-head.
3. For three or more teams tied in match record:
   - first isolate a team that beat every other tied team or lost to every other tied team;
   - if only two teams remain tied, use their head-to-head result;
   - otherwise rank the remaining tied group by set percentage.
4. If only two teams remain tied in match and set percentage, use head-to-head.
5. If three or more remain tied in match and set percentage:
   - when no team would be eliminated from Gold, rank by point percentage and use head-to-head if only two remain tied;
   - when a team would be eliminated from Gold, play tiebreaker sets for the last advancing spot.
6. Required tiebreaker sets are one set to 15 and may use two-, three-, or four-team playoff structures. The higher point-percentage teams receive the more favorable path.
7. If point percentage is also tied for three or more teams, the official procedure uses initial pool ranking to seed the tiebreak playoff.

### Calculations that will need precise definitions

- Match percentage / record: match wins divided by matches played.
- Set percentage: sets won divided by total sets played.
- Point percentage: points won divided by total points played.
- For three-team pools that play all three sets, all sets count toward set percentage even when a team wins the match after the first two sets.
- Forfeits and incomplete matches need an explicit product rule before these calculations can be implemented safely.

## Decision tree

### 1. Governing tiebreak policy — RESOLVED

Should this app implement the full current Adult Opens procedure, including live-scored one-set-to-15 tiebreak matches when a three-plus-team tie affects the final Gold/playoff qualifying spot, or should it always resolve standings statistically through point percentage?

Why this comes first: the answer determines whether bracket publication can happen immediately from pool results or whether the app needs a pre-playoff tiebreak stage.

Answer: Never allow the playoff bracket to be published immediately, an admin ALWAYS has to publish it. We don't do match play in pool play, ever. So remove that tiebreaker and let's implement the rest of the tiebreaker flow the way USAV does it.

Decisions:

- Brackets are never automatically published.
- Do not create or score pool-play tiebreak sets.
- Preserve the tournament's independent-set format and apply the adapted sequence: set/result record, tied-group head-to-head results, point percentage, then manual resolution.
- If three or more teams remain exactly tied after point percentage, leave their order unresolved.
- An unresolved tie blocks bracket generation until an admin manually orders the tied teams.
- The manual order resolves only that tied group and does not replace the calculated order of unaffected teams.

### 2. What qualifies from each pool — RESOLVED

- Number of advancing teams per pool
- Wild cards across pools, if any
- Whether different pools in one division may advance different counts
- Whether bracket size is fixed or generated from qualifiers

Answer: Bracket size will be determined ahead of any matches being played such as top two to gold and third place to silver or something like that. Allow an admin to change that after the fact as well. Different pools in the same division should always advance the same amounts. We will not handle wild cards.

Decisions:

- Advancement rules are configured before pool play.
- Every pool in the same category + division advances the same number of teams to each destination.
- No wild cards.
- Admins may revise advancement after pool play.
- Each category + division supports separate Gold and Silver brackets at the same time.
- Gold is required; Silver is optional.
- The exact mapping from pool finish positions into Gold and Silver remains configurable by the admin.

### 3. Bracket formats — RESOLVED FOR V1

- Single elimination, double elimination, placement brackets, consolation matches
- Supported bracket sizes and byes
- Bronze/third-place match
- Match/set format and target scores by round
- Court, work team, and scheduled time assignments

Answer: Single elimination, bracket size up to 8 teams, no third place matches, allow format to be set for each round, allow for court allocation and work team allocation but time isn't necessary.

Decisions:

- Single elimination only.
- Two through eight participants, with byes where required.
- No third-place match.
- Match format is configurable per round.
- Court and work-team assignments are configurable per match.
- No scheduled-time field.

### 4. Visibility and publication — RESOLVED

- Draft visible to admins only
- Whether publication is per bracket or for all playoffs in the event
- Whether edits to a published bracket appear immediately
- Whether public URLs return 404 or a not-yet-published page before publication

Answer: Publication is per bracket (division + category), edits to the admin side of a bracket don't need to be sent over websockets, they can require a refresh of the app (I'm not set on this, if it's easier to have them appear immediately we can do that). "Not-yet-published" page

Decisions:

- Draft brackets are admin-only.
- Publication is atomic for the category + division postseason configuration: Gold and Silver are published together.
- Before publication, public routes show a not-yet-published page rather than a 404.
- Admin structural edits may require refresh; implementation may use realtime if that is simpler and safer.

### 5. Seeding and generation — RESOLVED FOR V1

- Automatic seeding from final pool standings
- Cross-pool pairing rules
- Whether incomplete pools block generation
- Regeneration behavior after pool corrections
- Snapshot versus live linkage to pool standings

Answer: Yes automatic seeding, incomplete pools should block generation, regeneration can require a refresh, you should be able to navigate to pool standings

Decisions:

- Generate participants automatically from final pool standings and configured advancement rules.
- Allow the admin to prebuild the draft with pool-place placeholders before pool play is complete.
- Any incomplete pool in the category + division blocks generation.
- Regeneration may require refresh.
- Bracket setup must provide navigation back to the relevant pool standings.
- Support two seeding modes:
  - crossover mode pairs qualifiers by pool finish, such as Pool A #1 versus Pool B #2 and Pool B #1 versus Pool A #2;
  - optional reseed mode combines qualifiers across pools and seeds them into the bracket without preserving pool lanes.
- Crossover mode is expected primarily when a category + division has exactly two pools.
- Reseed mode orders qualifiers by pool finish, match percentage, set percentage, and point percentage.
- An exact reseed tie remains unresolved until an admin manually orders the tied teams.
- Advancement uses the same configured finish ranges for every pool; a finish may feed Gold, Silver, or neither, but never both.
- Resolved participants are a snapshot. Later pool changes mark the configuration stale and require reviewed regeneration.
- Regeneration is blocked when affected playoff scores exist.

### 6. Live scoring and advancement — RESOLVED FOR V1

- When a winner advances
- Reopening a finalized match
- Downstream-score conflicts after changing an earlier winner
- Realtime updates and concurrent scorers
- Match timer behavior

Answer: Just like live scoring, a winner should advance after the live scorer clicks "Mark Final". Only an admin can reopen playoff matches. Don't worry about down-stream conflicts on first version. Don't need match timer, follow the same rules as the current live scoring.

Decisions:

- Reuse the current set-scoring interaction and score validation.
- Playoff rounds use clinchable match formats with sets-to-win, normal-set target/cap, and deciding-set target/cap.
- Stop creating/scoring sets once a team clinches the match.
- Advance the winner only when the scorer marks the match final.
- Live score changes never alter downstream participants; advancement occurs only through the explicit `Mark Final` action, matching pool scoring.
- Only admins may reopen finalized playoff matches.
- No playoff match timer.
- Automatic downstream-conflict repair is out of scope for V1; conflicting operations must still be prevented from silently corrupting the bracket.

### 7. Manual editing and audit safety — RESOLVED FOR V1

- Editing participant slots, seeds, round names, and match structure
- Moving winners/losers to arbitrary destinations
- Locking scored matches against structural edits
- Confirmation and conflict warnings
- Whether to preserve an audit log of overrides

Answer: No audit log, admins have free reign to do whatever and if a conflict arises, notify the admin and don't save the changes.

Decisions:

- Admins may edit participants, assignments, format, and bracket structure.
- No audit log in V1.
- Validate the complete proposed bracket before saving.
- If an edit conflicts with scores, advancement, or bracket structure, explain the conflict and save nothing.

### 8. Team identity and data model — RESOLVED FOR V1

- Stable event-level team IDs
- Duplicate team names
- Category + division ownership
- Bracket, round, match, participant-source, and override models

Answer: Don't worry about duplicate team names, not sure what the question is for the rest of this.

Clarification for later: a pool seed such as `Team 1` is only unique inside one pool. Once teams from several pools enter one bracket, the app needs a durable reference to the original pool team so that a score correction, renamed team, or regenerated bracket updates the intended participant. This can be an internal ID and does not require duplicate-name handling in the UI.

Decision: add an invisible persistent ID to each pool team and use it for resolved participants, overrides, and work-team assignments. Existing events receive IDs during normalization.

### 9. User interface — RESOLVED FOR V1

- Navigation between Pool Play and Playoffs
- Division selection
- Desktop bracket and mobile presentation
- Admin setup/edit mode versus scorer mode
- Statuses for draft, live, complete, and corrected matches

Answer: A Playoff button should appear at the top next All Pools and Favorites that will take a user to a playoff "Home page" if nothing is published use that same "Not-yet-published" page. If there are published brackets then a user should be able to see them there. I also want it in the side menu. Make "women" and "men" collapsible and then the divisions under them are also dropdowns that will show "pools" and "playoffs". They should still be clickable to show all pools when a division or gender is picked. So let's add a small button that collapses and hides the menu underneath.

Just like pool setup, admins need a separate bracket setup page.

Decisions:

- Add a Playoffs button beside All Pools and Favorites.
- The playoffs home shows published brackets, or the not-yet-published state when none are public.
- Add Playoffs navigation to the side menu.
- Make category sections such as Women and Men collapsible.
- Make their division sections expandable to show Pools and Playoffs destinations.
- Category and division labels remain clickable pool filters.
- Use a separate admin-only bracket setup page patterned after Pool Setup.
- Desktop uses connected round columns.
- V1 mobile uses one vertically stacked round at a time with previous/next controls and a compact overview.
- A full image-like mobile bracket with connecting lines is deferred to Phase 2.

### 10. Edge cases — DEFERRED

- Forfeits, withdrawals, no-shows, and disqualifications
- Tiebreak matches and their officiating assignments
- Odd team counts and byes
- A team appearing in the wrong division
- Offline/realtime failures during advancement

Answer: Phase 2 problems

Decision: forfeits, withdrawals, no-shows, disqualifications, special operational recovery, and a full connected mobile bracket are explicitly deferred to Phase 2. Ordinary bracket byes are still required in V1.

## Decisions reached

- Use the tournament-adapted USAV sequence over independent set results and never play pool tiebreak sets.
- Leave exact three-plus-team ties after point percentage unresolved and require an admin to order the tied group before bracket generation.
- Require explicit admin publication; never publish automatically.
- Configure equal per-pool advancement rules before play, with no wild cards and admin correction afterward.
- Support simultaneous named Gold and Silver brackets within each category + division.
- Require Gold and make Silver optional.
- Publish Gold and Silver together for a category + division.
- Use single-elimination brackets of up to eight teams, no third-place match, and configurable per-round scoring formats.
- Use two-, four-, or eight-slot layouts and award byes to the highest seeds.
- Support court and work-team assignments, but not scheduled times or playoff timers.
- Generate only after every relevant pool is complete.
- Allow prebuilding with pool-place placeholders before pool play finishes.
- Support crossover generation and optional cross-pool reseeding.
- In reseed mode, order by pool finish, match percentage, set percentage, and point percentage; require manual ordering for exact ties.
- Advance winners when matches are marked final; only admins may reopen them.
- Permit broad manual admin edits but reject the entire save when validation finds a conflict.
- Add dedicated public playoffs navigation and a separate admin setup page.
- Defer exceptional tournament operations to Phase 2.
- Use true clinchable playoff matches with configurable normal and deciding-set formats.
- Snapshot resolved bracket participants and require reviewed regeneration after pool-result changes.
- Store manual slot overrides separately from calculated sources and allow resetting to calculated.
- Keep publication separate from a server-enforced scoring-open control.
- Use stable internal team IDs.
- Realtime-update scoring, advancement, locks, and publication; broadcast saved structural changes as bracket snapshots.
- Match the pool scorer's current last-write-wins persistence behavior for playoff score writes.
- Validate publication prerequisites and reject structural edits atomically when scored matches conflict.
- Use a round-by-round mobile UI in V1; defer a fully connected mobile bracket to Phase 2.

## Follow-up iterations

### Iteration 1 — Terminal statistical tie

Question: If three or more teams remain exactly tied after match record, tied-group head-to-head, set percentage, and point percentage, how should their final order be determined when the tournament does not play tiebreak sets?

Answer: Leave them unresolved until an admin manually orders them.

Resulting decisions:

- Keep the tied group explicitly unresolved.
- Block bracket generation while the unresolved tie affects qualification or seeding.
- Let an admin manually order only the tied teams; calculated placement for all unaffected teams remains unchanged.

### Iteration 2 — Multiple postseason brackets

Question: Should one category + division support multiple named brackets, such as Gold and Silver, at the same time?

Answer: Yes gold and silver brackets

Resulting decisions:

- A single category + division postseason configuration may contain both a Gold bracket and a Silver bracket.
- Gold and Silver have separate participants, matches, and winners.
- The admin configures which pool finish positions feed each bracket.

### Iteration 3 — Gold and Silver publication

Question: Should Gold and Silver be published independently, or should publishing playoffs for a category + division make both brackets public together?

Answer: Both should be published at the same time.

Resulting decisions:

- Gold and Silver share one publication state within a category + division.
- Public users see neither bracket while the postseason configuration is a draft.
- Publishing or unpublishing affects both brackets atomically.

### Iteration 4 — Cross-pool seeding basis

Question: Should automatic bracket generation pair teams by pool finish and deliberately avoid same-pool rematches in the opening round, or should it combine all qualifiers into one statistical ranking across pools and seed them 1 through N?

Recommendation: use pool finish and cross-pool pairing. Results from different pools are not always directly comparable, and this gives predictable pairings such as Pool A #1 versus Pool B #2 while delaying rematches.

Answer: Let's have both options be available. Something like "Reseed" checkbox that if checked will reseed all the teams regardless of pool and create the bracket. If "Reseed" isn't checked, then it should just be crossover like Pool A 1 seed vs Pool B 2 seed and Pool B 1 seed vs Pool A 2 seed. This will almost only occur if there are only two pools.

Resulting decisions:

- Add a `Reseed` option to bracket setup.
- With `Reseed` off, use pool-finish crossover pairings and avoid an opening-round same-pool rematch.
- With `Reseed` on, rank all qualifiers across pools and place them by bracket seed.
- Optimize the default crossover behavior for the common two-pool case while retaining manual admin editing for other layouts.

### Iteration 5 — Reseed ranking formula

Question: When `Reseed` is enabled, what should rank teams from different pools?

Recommendation: sort by pool finish first, then match percentage, set percentage, point percentage, and finally require an admin decision for any exact tie. This prevents a second-place team with inflated scores from jumping a first-place pool finisher while still comparing teams that earned the same pool position.

Answer: Use the recommended formula.

Resulting decisions:

- In reseed mode, sort first by pool finish.
- Among teams with the same pool finish, compare match percentage, then set percentage, then point percentage.
- Do not use cross-pool head-to-head because those teams generally have not played each other.
- Leave an exact tie unresolved and block generation until an admin orders that tied group.

### Iteration 6 — Byes and bracket sizing

Question: For a field that is not a power of two, should the app create the next standard bracket size and give byes to the highest seeds—for example, a three-team field uses a four-team bracket with Seed 1 receiving the bye, and a six-team field uses an eight-team bracket with Seeds 1 and 2 receiving byes?

Recommendation: Yes. This is deterministic, works cleanly for every supported field from two through eight teams, and preserves the value of higher seeding.

Answer: Use the recommended behavior.

Resulting decisions:

- Use standard bracket sizes of two, four, or eight slots.
- Expand a three-team field to four slots and a five-, six-, or seven-team field to eight slots.
- Award byes to the highest seeds.
- Treat a bye as automatic placement into the next round, not as a scored or completed match.

### Iteration 7 — Optional Gold or Silver bracket

Question: Must every category + division always have both Gold and Silver, or may an admin enable only Gold when that tournament has no Silver bracket?

Recommendation: Make Gold required and Silver optional. When Silver is enabled, Gold and Silver still publish together as already decided.

Answer: Use the recommended behavior.

Resulting decisions:

- Every postseason configuration has a Gold bracket.
- Silver may be enabled or omitted by the admin.
- If Silver is enabled, Gold and Silver retain their shared publication state.

### Iteration 8 — Prebuild with pool-place placeholders

Question: Before pool play is complete, should the admin be able to build the full draft bracket using source placeholders such as `Pool A #1` and `Pool B #2`, including round formats, courts, and work teams, with actual team names filled in after standings become final?

Recommendation: Yes. It satisfies the requirement to determine the structure ahead of play and lets the tournament prepare assignments early, while generation/publication remains blocked until every source resolves.

Answer: Use the recommended behavior.

Resulting decisions:

- Build bracket structure before pool play finishes using durable source slots such as `Pool A #1`.
- Allow round formats, courts, and work assignments to be configured while participants are placeholders.
- Resolve placeholders to actual teams only after every source pool is final and all required ties are resolved.
- Block publication while any participant source remains unresolved.

### Iteration 9 — Pool standings unit

Question: Because this tournament's pool formats commonly play one or two independent sets rather than best-of matches, should each finalized pool set count as one standings result instead of trying to derive a match winner?

Recommendation: Yes. Preserve the tournament's existing set-as-result model. Adapt the USAV sequence to: result record, tied-group head-to-head results, point percentage, then manual admin ordering for an exact three-plus-team tie. Set percentage would be redundant because each set is already the primary result.

Dependency assumption used below: Recommended behavior.

Status: Use the recommended behavior.

### Iteration 10 — Playoff match format

Question: Should playoff rounds use true clinchable matches rather than the pool-play set-as-result format?

Recommendation: Yes. Configure each round with `setsToWin`, normal-set target/cap, and deciding-set target/cap. Stop the match when a team reaches `setsToWin`; unneeded sets are never played. Suggested presets include one set to 25, best two-of-three with a deciding set to 15, and configurable caps.

Dependency assumption: Iteration 9 uses independent pool results, while playoffs use clinchable matches because a single winner must advance.

Status: Use the recommended behavior.

### Iteration 11 — Advancement mapping

Question: How should admins assign pool finishes to Gold and Silver?

Recommendation: Configure the same finish ranges for every pool in the category + division, such as Gold `1-2`, Silver `3`, and unassigned `4+`. A finish may feed at most one bracket; unused finishes are allowed; overlaps are validation errors.

Status: Use the recommended behavior.

### Iteration 12 — Pool corrections after resolution

Question: What should happen if pool results change after placeholders have resolved to teams?

Recommendation: Treat the postseason draft as a snapshot. Mark it `Pool results changed — regeneration required`, but never silently replace participants. An admin reviews and regenerates. If playoff scoring has begun, reject regeneration until conflicting playoff scores are explicitly cleared.

Status: Use the recommended behavior.

### Iteration 13 — Publication prerequisites

Question: What must be valid before Gold and Silver can be published?

Recommendation: Require every source pool to be final, all statistical ties affecting placement to be manually resolved, every participant slot to resolve, all match paths and round formats to validate, and no duplicate team assignment. Court and work-team assignments remain optional so an operational omission does not block publication.

Status: Use the recommended behavior.

### Iteration 14 — Structural edit conflicts

Question: Which admin edits should be rejected once playoff scores exist?

Recommendation: Reject changes to a participant, source, seed, format, or advancement path when the affected match or any dependent downstream match has a score. Name the conflicting matches and save nothing. The admin must first reopen and clear those scores, working backward from the latest affected round.

Status: Use the recommended behavior.

### Iteration 15 — Manual participant overrides

Question: How should last-minute team substitutions or corrected seeds be represented?

Recommendation: Let each opening-round slot retain its calculated source and optionally store an explicit admin override. Show both, label overridden slots, and provide `Reset to calculated`. Overrides survive refresh and regeneration unless the admin explicitly clears them.

Status: Use the recommended behavior.

### Iteration 16 — Playoff scoring lock

Question: Should publication and permission to score be separate controls?

Recommendation: Yes. Add a category + division `Scoring open` setting, analogous to pool `editable`. Published brackets remain publicly viewable when scoring is locked; public score writes are rejected by both UI and server; admins may still correct scores.

Status: Use the recommended behavior.

### Iteration 17 — Stable team identity

Question: How should the bracket identify a team independently of its name or pool-local seed?

Recommendation: Add a persistent internal ID to every pool team and reference that ID from resolved bracket slots, work assignments, and overrides. Keep the ID invisible in normal UI. Existing events receive IDs during normalization/migration.

Status: Use the recommended behavior.

### Iteration 18 — Work-team choices

Question: What values may be assigned as the work team for a playoff match?

Recommendation: Allow `None` or any team in the same category + division, referenced by stable team ID. Do not use free text. Warn, but do not block, if the selected team is also scheduled to play in the same round.

Status: Use the recommended behavior.

### Iteration 19 — Realtime boundary

Question: Which playoff changes must update live without refresh?

Recommendation: Realtime-update score changes, match finalization, winner advancement, scoring-lock changes, and publication/unpublication. Allow draft structural/setup edits to require refresh until saved; on save, publish one bracket snapshot update rather than granular edit messages.

Status: Use the recommended behavior.

### Iteration 20 — Concurrent edits

Question: How should the app prevent two admins or scorers from overwriting each other?

Recommendation: Store a bracket revision and match `updatedAt`. Reject a stale structural save with a refresh-required message. For scoring, reuse the current match-level persistence pattern and reject updates against a participant/revision that has changed.

Answer: The current pool scorer uses last-write-wins. A score request sends the full match. The server does not compare the submitted `updatedAt` with stored state; it stamps a new time, overwrites the match, and broadcasts it. Clients accept the broadcast with the newer timestamp. Concurrent edits to the same match can therefore overwrite each other without warning.

Recommendation: Do not copy that weakness into playoffs. Use the proposed bracket revision and match `updatedAt` preconditions because a lost playoff update can also advance the wrong team. Return a conflict response and require refresh when the submitted revision is stale.

Answer: Match the pool scorer's current last-write-wins behavior.

Resulting decisions:

- Playoff score writes use the same last-write-wins persistence model as pool scoring.
- A score update never advances a team, even if the displayed score is sufficient to clinch the match.
- The winner advances only when a scorer explicitly selects `Mark Final`, equivalent to the existing pool-sheet action.
- The finalization request persists the final match state and downstream participant advancement together so public clients do not observe a finalized match without its winner placement.

Status: Resolved.

### Iteration 21 — Responsive bracket presentation

Question: How should an up-to-eight-team bracket render on phones?

Recommendation: Desktop shows connected round columns. Mobile shows one vertically stacked round at a time with Previous/Next round controls and a compact overview; do not shrink the full bracket until text is unreadable. Match cards reuse the existing live-score interaction.

Status: Use the recommended behavior. For the next phase, I'll want an image like UI where a mobile user can see the entire bracket with lines connecting games and the typical bracket view.

### Iteration 22 — Public playoffs home

Question: How should published Gold and Silver brackets appear on the playoffs home?

Recommendation: Group by collapsible category and division, matching pool navigation. Within a division, show Gold first and Silver second, each with Draft/Live/Complete status for admins and Live/Complete for public users. Selecting a bracket opens its full view; completed brackets prominently show the champion.

Status: Use the recommended behavior.

### Iteration 23 — Unpublish, reset, and deletion

Question: What destructive controls are allowed after publication?

Recommendation: Allow unpublishing without deleting scores. Allow reset/regeneration only when no playoff scores exist; otherwise require the admin to clear affected matches first. Require confirmation before clearing scores or deleting a postseason configuration. Never combine `Unpublish` with data deletion.

Status: Use the recommended behavior.


