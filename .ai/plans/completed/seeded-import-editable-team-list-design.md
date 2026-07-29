# Seeded Import Editable Team List

## Idea

After importing a seeded team list, keep an editable ordered source list so an admin can remove a team or insert a team at a specific position before creating pools.

## Recommendation

Implement this as an editable pre-generation source list, not as direct editing of the generated pool cards.

The source of truth should be the ordered team list. The generated pools should remain a derived preview. Any insert, remove, or name edit regenerates the preview from the current list.

## Scope Boundary

### Recommended v1

- Import teams from text/file as today.
- Convert the import into editable draft rows.
- Display the rows in seed order.
- Allow inline team name edits.
- Allow insert above/below a row.
- Allow remove row.
- Automatically renumber rows to `1..N` after insert/remove.
- Recompute the pool preview after every valid draft change.
- Keep existing validation: too few teams blocks creation, duplicate names warn, invalid blank names block creation.
- Add reset/re-import affordance to return to the originally imported file contents.

### Avoid in v1

- Editing the generated pool cards directly.
- Preserving seed gaps after deletion.
- Letting users assign a team directly to a pool/slot after snake distribution.
- Saving partially edited import drafts to the backend before pools are created.
- Complex undo history beyond reset to import.

## Main Design Questions

1. Does "specific slot" mean the global seed position before pools are generated, or a specific pool/card slot after the snake algorithm has run?
2. If seed 8 is removed, should seed 9 become seed 8, seed 10 become seed 9, and so on?
3. If a team is inserted at seed 8, should the old seed 8 shift to seed 9?
4. Should admins be able to edit names inline, or only add/remove rows?
5. Should blank inserted rows be allowed temporarily while editing, with Create blocked until filled?
6. Should there be a reset button that restores the original imported list?
7. Should edits persist if the admin navigates away before creating pools?
8. Should changing the team count be allowed to change pool count/distribution automatically?

## Recommended Answers

1. Treat "slot" as global seed position.
2. Yes, remove should shift all later teams up.
3. Yes, insert should shift all later teams down.
4. Yes, inline name editing should be included; otherwise add/remove is less useful.
5. Yes, but blank rows should block pool creation.
6. Yes, reset to imported list is useful and low-risk.
7. No, not in v1. The draft is setup UI state only.
8. Yes, because the preview already communicates the resulting pools.

## Difficulty

This is not hard if it is kept as a pre-generation list editor.

It becomes materially harder if we try to edit generated pools directly, preserve arbitrary original seed numbers, support seed gaps, or save import drafts server-side.

## Implementation Shape

- Add a draft list state to `PoolSetupComponent`.
- Populate the draft list from `parseSeededTeams(...)` after import/paste.
- Add a preview builder path that accepts draft rows directly, or convert draft rows back into canonical seeded text before preview.
- Renumber draft rows after any insert/remove.
- Validate draft rows before calling the existing pool generation rules.
- Update the seeded import template to show:
  - row number/seed
  - editable team name
  - insert control
  - remove control
  - reset/re-import action

## Risk Notes

- Reordering teams changes the generated pool assignments substantially because the snake distribution is seed-order dependent.
- The UI must make it clear that the list is the source, and the pool cards are only the preview.
- The current validation rejects missing seed numbers, which supports the recommended auto-renumbering model.
- If users expect to place a team into a specific generated pool, this design will feel indirect.

## Post-Generation Category+Division Update

### New Idea

After pools have already been generated for a category+division, allow an admin to open an update workflow that reproduces the original global seed list, edits that list, regenerates pools, and replaces that category+division.

### Important Constraint

Generated pools currently store only local pool seeds and names:

- Pool A team 1
- Pool A team 2
- Pool B team 1
- Pool B team 2

They do not store the original global seed each team came from.

Because seeded import uses snake distribution, the original global seed can only be reconstructed if the app knows the exact generation algorithm and options that were used. If the algorithm/options change later, or if pools were manually edited after creation, reconstruction becomes unreliable.

### Strong Recommendation

Do not reconstruct the source list from generated pools as the main source of truth.

Instead, store a `seedSource`/`seededImportSource` object when seeded pools are created:

- category
- division
- team list in global seed order
- generation settings
- pool size strategy / prioritize-five-team-pools flag
- schedule formats by pool size
- court numbers
- match timer
- hidden/editable defaults at generation time
- created/updated timestamp

Then the update workflow loads that stored source list, lets the admin edit it, regenerates pools, and uses the existing category+division bulk replace endpoint.

### Fallback For Existing Generated Pools

For pools that were generated before this metadata exists, we can offer a best-effort "rebuild seed list from current pools" action only if:

- the category+division pools still match a known seeded distribution shape
- pool titles/order are intact enough to infer pool order
- team counts match a valid seeded import distribution
- there are no duplicate team names that make review ambiguous

This should be labeled as a reconstruction/review step, not treated as authoritative.

### Recommended UX

- Admin opens category+division menu.
- Clicks `Update seeded list`.
- If stored source exists, show the editable global seed list immediately.
- If no stored source exists, show a reconstructed draft with a warning.
- Admin edits the list.
- Preview shows the regenerated pools.
- Saving replaces only that category+division.
- If existing pools have scores, require the same scored-pool confirmation already used by bulk replace.

### Hard Questions

1. Should updating from a seed list wipe all scores for that category+division?
2. If only a team name changes but the generated pool structure is identical, should scores be preserved?
3. If a team is inserted or removed, should all scores be wiped because matchups may shift?
4. Should the update preserve pool hidden/editable state from the existing pools or use the regenerated setup defaults?
5. Should court numbers be recalculated from the updated source settings or preserve existing pool courts?
6. Should pool IDs stay the same when pool count and team assignments match?
7. Should public viewers see the category+division disappear briefly during update, or should the server replace atomically?
8. Should manual pools in the same category+division be protected from this update, or replaced too?

### Recommended Answers

1. Wipe scores for any category+division seeded update.
2. Do not preserve scores, even for pure team-name changes. This workflow is specifically pre-tournament setup.
3. Yes, insert/remove should be treated as a structural regeneration and wipe scores after confirmation.
4. Preserve existing hidden/editable state at the division level if all existing pools agree; otherwise use the update form values.
5. Recalculate courts from the update form unless the admin chooses to preserve current court assignments.
6. Generate new pools and do not preserve pool IDs.
7. Server should replace atomically through the existing bulk endpoint.
8. The update should target all pools in that category+division, but the UI should warn if any target pool was not created from a seeded source.

### Difficulty

Medium if we store seed-source metadata from now on.

High and riskier if we try to reconstruct historical seed lists without metadata.

### Implemented Foundation

- Seeded imports now store a durable `seededPoolSource` object on each generated pool.
- Each generated team now stores `seededSourceSeed`, the original global seed from the imported list.
- Pool summaries display that original global seed as a small badge to the left of the team name.
- Manual pools and full event CSV imports explicitly set `seededPoolSource` to `null`.
