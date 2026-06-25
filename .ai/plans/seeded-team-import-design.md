# Seeded Team Pool Import Design Tree

Status: Ready for implementation

## Goal

Allow an admin to import seeded teams while setting up a pool in an event that already exists. The import contains seeded teams only. Pool Setup acts as the configuration template, and the app automatically creates multiple pools using the current Pool Setup rules.

This is a different import mode from full event CSV import:

- Full event import creates a new event and explicit pools.
- Seeded team import starts from an existing event and creates generated pools from a seeded team list.

## Current Proposal

Admin opens Pool Setup.

Pool Setup has a mode toggle:

- Manual single-pool setup.
- Seeded multi-pool import.

The CSV contains one of three accepted formats:

- Headered two-column: `seed,team_name`
- Headerless two-column: `seed,team_name`
- Headerless one-column: `team_name`, with seed inferred from row order

The app should:

- Use the current Pool Setup division for every generated pool.
- Use seeded import scoring rules by generated pool size.
- Sort teams by seed.
- Create pools automatically.
- Snake seeded teams into pools.
- Prefer as many 4-team pools as possible.
- Use 5-team pools as needed.
- Once there are more than 16 teams, use no more than three 5-team pools.
- For 11 teams, create one 4-team pool and one 7-team pool.
- For 6 teams, create one 6-team pool.
- For 7 teams, create one 7-team pool.
- Block imports with fewer than 6 teams.

## Draft CSV Shape

One row per team. Headered two-column format:

```csv
seed,team_name
1,Team Alpha
2,Team Beta
3,Team Gamma
4,Team Delta
5,Team Echo
6,Team Foxtrot
```

Headerless two-column format:

```csv
1,Team Alpha
2,Team Beta
3,Team Gamma
4,Team Delta
5,Team Echo
6,Team Foxtrot
```

Headerless one-column format:

```csv
Team Alpha
Team Beta
Team Gamma
Team Delta
Team Echo
Team Foxtrot
```

## Draft Column Contract

| Column | Required | Notes |
| --- | --- | --- |
| `seed` | No | Numeric seed within the selected division. Required for two-column rows. Inferred from row order for one-column team-name-only rows. |
| `team_name` | Yes | Display name for the team. |

Division is selected in Pool Setup, not included in the CSV.

## Pool Size Rules

| Team count | Pool sizes | Status |
| --- | --- | --- |
| 1-5 | Block import | Decided |
| 6 | `6` | Decided |
| 7 | `7` | Decided |
| 8 | `4 + 4` | Confirmed |
| 9 | `4 + 5` | Decided |
| 10 | `5 + 5` | Decided |
| 11 | `4 + 7` | Decided, assignment needs confirmation |
| 12 | `4 + 4 + 4` | Confirmed |
| 13 | `4 + 4 + 5` | Confirmed |
| 14 | `4 + 5 + 5` | Decided |
| 15 | `5 + 5 + 5` | Confirmed |
| 16 | `4 + 4 + 4 + 4` | Confirmed |
| 17 | `4 + 4 + 4 + 5` | Confirmed |
| 18 | `4 + 4 + 5 + 5` | Confirmed |
| 19 | `4 + 5 + 5 + 5` | Confirmed |
| 20 | `4 + 4 + 4 + 4 + 4` | Confirmed |

For more than 16 teams:

- Use as many 4-team pools as possible.
- Add one to three 5-team pools only to absorb the remainder.
- Do not create more than three 5-team pools.

## Draft Snake Behavior

User-proposed uneven-pool rule:

- Snake the largest team count divisible by 4.
- Ignore the final `teamCount % 4` teams during initial snaking.
- Add those remainder teams to the last pools, working backwards.
- Larger pools therefore appear at the end of the pool list.

### 9 Teams

Base snake 8 teams into two 4-team pools, then add seed 9 to the last pool.

```text
Pool 1: 1, 4, 5, 8
Pool 2: 2, 3, 6, 7, 9
```

### 10 Teams

Base snake 8 teams into two 4-team pools, then add seed 9 to Pool 2 and seed 10 to Pool 1.

```text
Pool 1: 1, 4, 5, 8, 10
Pool 2: 2, 3, 6, 7, 9
```

### 11 Teams

Explicit special case: `4 + 7`.

The general remainder algorithm would produce `5 + 6`, so 11 teams needs a separate assignment rule.

Potential special-case draft:

```text
Pool 1: 1, 4, 5, 8
Pool 2: 2, 3, 6, 7, 9, 10, 11
```

This is correct.

### 13 Teams

Base snake 12 teams into three 4-team pools, then add seed 13 to Pool 3.

```text
Pool 1: 1, 6, 7, 12
Pool 2: 2, 5, 8, 11
Pool 3: 3, 4, 9, 10, 13
```

### 14 Teams

Base snake 12 teams into three 4-team pools, then add seed 13 to Pool 3 and seed 14 to Pool 2.

```text
Pool 1: 1, 6, 7, 12
Pool 2: 2, 5, 8, 11, 14
Pool 3: 3, 4, 9, 10, 13
```

### 17 Teams

Base snake 16 teams into four 4-team pools, then add seed 17 to Pool 4.

```text
Pool 1: 1, 8, 9, 16
Pool 2: 2, 7, 10, 15
Pool 3: 3, 6, 11, 14
Pool 4: 4, 5, 12, 13, 17
```

### 18 Teams

Base snake 16 teams into four 4-team pools, then add seed 17 to Pool 4 and seed 18 to Pool 3.

```text
Pool 1: 1, 8, 9, 16
Pool 2: 2, 7, 10, 15
Pool 3: 3, 6, 11, 14, 18
Pool 4: 4, 5, 12, 13, 17
```

### 19 Teams

Base snake 16 teams into four 4-team pools, then add seed 17 to Pool 4, seed 18 to Pool 3, and seed 19 to Pool 2.

```text
Pool 1: 1, 8, 9, 16
Pool 2: 2, 7, 10, 15, 19
Pool 3: 3, 6, 11, 14, 18
Pool 4: 4, 5, 12, 13, 17
```

## Decision Tree

### 1. Import Target

Question: Where does this import live?

Decision: Pool Setup. Add a toggle that switches Pool Setup from manual single-pool team naming to seeded multi-pool import.

When seeded import mode is active:

- Hide/remove the manual team naming controls for the current draft pool.
- Hide `teamCount`; generated pool sizes are determined by imported team count.
- Show CSV upload controls for `seed,team_name`.
- Show scoring settings for generated 4-, 5-, 6-, and 7-team pools.
- Use the selected division for all generated pools.

~~### 2. Modal~~

~~Question: What does the modal ask before file import?~~

~~Decision:~~

~~- Division for this import.~~
~~- Whether to overwrite existing pools or add on top.~~

### 2. Existing Event Behavior

Question: What happens if the event already has pools?

Decision: Give the user an option in Pool Setup.

Overwrite means remove/replace only existing pools in the selected division.

### 3. Scored Pool Safety

Question: Can this import modify/delete pools if scoring has already started?

Decision: Allow with explicit destructive confirmation.

### 4. Division Grouping

Question: Should the app snake teams separately per division?

Decision: Each import uses one selected Pool Setup division.

### 5. Minimum Team Count

Question: If selected division import has fewer than 6 teams, should import block?

Decision: Yes. Block import for fewer than 6 teams.

### 6. Pool Size Algorithm

Question: What exact pool sizes should be generated?

Decision: Use the pool size table above.

### 7. More Than 16 Teams

Question: For more than 16 teams, what does "no more than three 5-team pools" mean?

Decision: Use as many 4-team pools as possible, then one to three 5-team pools only to absorb the remainder.

### 8. Uneven Snake

Question: How should snake assignment work when pools have different sizes?

Decision: Snake the divisible-by-4 base teams first, then add remainder teams to the last pools working backwards.

11-team special case confirmed:

```text
Pool 1: 1, 4, 5, 8
Pool 2: 2, 3, 6, 7, 9, 10, 11
```

### 9. Pool Naming

Question: How should generated pools be named?

Decision: `Pool 1`, `Pool 2`, etc.

### 10. Pool Order

Question: How should generated pools be ordered in the event?

Decision: Generated pools are appended in generated order, as if they were added one at a time.

### 11. CSV Columns

Question: Should the CSV include division or scoring settings?

Decision: CSV contains only `seed` and `team_name`. Division and scoring settings come from Pool Setup.

### 12. Scoring Defaults

Question: Should generated pools use default scoring settings from existing pool rules?

Decision: Generated pools use the current Pool Setup rules.

Correction: Generated pools use seeded import scoring settings by generated pool size.

Seeded import mode should expose settings for each possible generated pool size:

| Generated pool size | Settings |
| --- | --- |
| 4 | `gamesPerMatch`, `targetScore`, `pointCap` |
| 5 | `gamesPerMatch`, `targetScore`, `pointCap` |
| 6 | `gamesPerMatch`, `targetScore`, `pointCap` |
| 7 | `gamesPerMatch`, `targetScore`, `pointCap` |

### 13. Preview

Question: Should this import show a dry-run preview before applying changes?

Decision: Yes. CSV upload parses immediately and shows a preview. Saving requires a separate `Create Pools` button.

### 14. Add vs Overwrite Location

Question: Where does the admin choose add vs overwrite?

Decision: Pool Setup seeded import mode.

Control shape: Checkbox labeled like `Replace existing pools in this division`.

### 15. Original Draft Pool

Question: Should the original draft pool be saved as one of the generated pools?

Decision: No. Discard the draft pool and replace it with generated pools when saving seeded import.

### 16. Backend Write Shape

Question: Should this flow create all generated pools with one backend endpoint, or save generated pools one at a time?

Decision: Use one backend endpoint that applies all generated pools in one operation.

### 17. Seed Validation

Question: Should seeds have to be exactly `1..N` with no gaps?

Decision: Yes. Missing seeds are blocking errors and should report which seed is missing.

### 18. Append Pool Naming

Question: For append mode, should generated pool names continue after existing event pool count, or after existing pools in the selected division only?

Decision: Continue after existing pools in the selected division only.

### 19. Scored Pool Confirmation

Question: For overwrite mode, should deletion of scored pools require typed confirmation?

Decision: No. A confirm dialog is enough.

### 20. Preview Content

Question: Should preview show pool cards with teams and generated schedules before saving?

Decision: Yes.

### 21. Default Scoring Settings By Pool Size

Question: What are the default scoring settings for each generated pool size?

Decision:

| Pool size | Games per match | Target score | Point cap |
| --- | --- | --- | --- |
| 4 | 2 | 15 | 17 |
| 5 | 2 | 11 | 13 |
| 6 | 1 | 15 | 17 |
| 7 | 1 | 15 | 17 |

### 22. No Cap

Question: Can `pointCap` be blank/no cap for each pool size?

Decision: Yes.

### 23. CSV Template

Question: Should the seeded import CSV template be downloadable from Pool Setup?

Decision: No.

### 24. Unknown Extra CSV Columns

Question: Should unknown extra CSV columns warn or block?

Decision: Ignore.

### 25. Duplicate Team Names

Question: Should duplicate `team_name` warn or block?

Decision: Warn.

### 26. Duplicate Seeds

Question: Should duplicate seeds block?

Decision: Yes.

### 27. Blank Lines

Question: Should blank lines block or be ignored?

Decision: Ignore.

### 28. Post-Success Navigation

Question: After successful creation, should the admin land on the event dashboard or the first generated pool?

Decision: Event dashboard.

### 29. Cross-Division Duplicate Pool Titles

Question: If append mode creates `Pool 3` and `Pool 4` but those titles already exist elsewhere in another division, is that allowed?

Decision: Yes.

### 30. Mode Toggle Labels

Question: What should the mode toggle labels be?

Decision: `Manual pool` and `Seeded import`.

### 31. Seeded Import Action Label

Question: What should the final save button say in seeded import mode?

Decision: `Create Pools`.

### 32. Preview Recalculation

Question: If the admin changes scoring settings or division after previewing, should the preview update automatically?

Decision: Yes. Preview updates automatically when seeded import settings or division change.

### 33. Atomic Replace Behavior

Question: Should the endpoint replace selected-division pools atomically with generated pools, preserving unrelated division pools and their order?

Decision: Yes.

### 34. Append Position

Question: In append mode, should new generated pools be appended after all existing event pools, or inserted after existing pools in the selected division?

Decision: Insert after existing pools in the selected division.

### 35. Empty Import

Question: Should a selected CSV with only headers and no teams show a blocking "No teams found" error?

Decision: Yes.

### 36. CSV Format

Question: Should the importer accept both headered and headerless CSV, and should it accept team-name-only rows?

Decision: Yes. Accept all of:

- Headered `seed,team_name`
- Headerless `seed,team_name`
- Headerless `team_name`, with seed inferred by row order

If a `seed,team_name` header row is present, ignore it. Header matching should only be used to skip the header, not to support arbitrary column order.

### 37. Headerless Column Order

Question: For headerless two-column CSV, should column order be exactly `seed,team_name`?

Decision: Yes.

### 38. Backend Contract

Question: Should the frontend generate pools and send generated pool objects to a multi-pool endpoint, matching current single-pool save behavior, while the server sanitizes and atomically applies them?

Decision: Yes.

### 39. Scored Overwrite Confirmation Contract

Question: In overwrite mode, if selected-division pools have scores, should frontend confirm before calling the backend, and should backend also reject unless an explicit `confirmOverwriteScored` flag is sent?

Decision: Yes.

## Implementation Contract

- UI lives in Pool Setup behind a `Manual pool` / `Seeded import` toggle.
- Seeded import mode hides manual team naming and `teamCount`.
- Seeded import mode shows scoring settings for 4-, 5-, 6-, and 7-team generated pools.
- CSV parses immediately and preview updates automatically when CSV, division, or scoring settings change.
- `Create Pools` calls one backend endpoint with generated pool objects.
- Backend sanitizes pools and atomically applies them.
- Overwrite removes/replaces only selected-division pools.
- Append inserts generated pools after existing pools in the selected division.
- Backend preserves unrelated division pools and their order.
- Backend rejects scored overwrites unless `confirmOverwriteScored` is true.
- Success navigates to the event dashboard.

## Resolved Final Questions

1. CSV format: when you say "no header necessary", should the importer accept both headered and headerless CSV, or should it require headerless rows only? both, also accept just team names in order as seeded
2. Headerless column order: should it be exactly `seed,team_name`? yes
3. If a header row is present anyway, should it be ignored if it matches `seed,team_name`, or treated as invalid data? ignored
4. Backend contract: should the frontend generate the pools and send the generated pool objects to a multi-pool endpoint, matching current single-pool save behavior, while the server sanitizes and atomically applies them? yes
5. In overwrite mode, if there are selected-division pools with scores, should the frontend confirm before calling the backend, and should the backend also reject unless an explicit `confirmOverwriteScored` flag is sent? yes
6. Should this spec be marked ready after these answers? Stop asking this question and confirm all decision paths are answered in order to mark the spec as ready
