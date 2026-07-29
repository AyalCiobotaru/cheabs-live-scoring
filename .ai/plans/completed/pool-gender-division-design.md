# Pool Gender / Division Design Tree

## Goal

Differentiate pools by category (`Women`, `Men`, `Coed`, `RevCo`) and division (`Open`, `AA`, `A/AA`, `A`, `BB`, `B/BB`, `B`). Existing pools should default to `Men`.

## Current Behavior From Code

- Pools currently have a single `division` string.
- Valid divisions are defined in `frontend/src/app/util/division-rules.ts`.
- Pool setup exposes one division dropdown.
- Side menu exposes one flat `Divisions` dropdown.
- Event dashboard groups cards by division only.
- Route query params filter by `division` only.
- CSV import supports a `division` column but no category/gender column.
- OCR scan can infer and normalize division but has no category/gender concept.

## Proposed UX

- Side menu dropdown becomes hierarchical:
  - Women
    - Open, AA, A/AA, A, BB, B/BB, B
  - Men
    - Open, AA, A/AA, A, BB, B/BB, B
  - Coed
    - Open, AA, A/AA, A, BB, B/BB, B
  - RevCo
    - Open, AA, A/AA, A, BB, B/BB, B
- Event dashboard sections become expandable/collapsible category sections.
- Dashboard order starts with Women, then Men, then Coed, then RevCo.
- Inside each category, divisions keep existing division sort order.
- Existing pools normalize to `Men`.

## Design Questions

1. Is the stored field name `category`, `gender`, or `poolType`? category
2. Is `Coed/RevCo` one option or should `Coed` and `RevCo` be separate options? Separate
3. Should existing `division` values stay exactly as-is, with a new category field added? yes
4. Should URL filtering become `?category=Women&division=A`, or should it preserve the current single `division` param? category and division
5. Should side menu allow selecting an entire category, or only category + division leaves? entire category and category + division leaves
6. Should `All divisions` become `All pools`, `All Women`, `All Men`, `All Coed/RevCo`? Remove all pools and it should be replaced with All Women, All Men, All Coed, All RevCo.
7. Should dashboard category sections default open or collapsed? open
8. Should hidden pool publishing act per category+division instead of division only? yes.
9. Should seeded import use the selected category for all generated pools? yes
10. Should CSV event import gain a `category` column now, defaulting blank to `Men`? No, this should be a dropdown in the app
11. Should OCR pool sheet scanning attempt to infer category, or leave category unchanged? no
12. Should favorites view preserve category grouping or show a flat favorite list? yes
13. Should labels say `Women`/`Men`, or `Women's`/`Men's`? `Women` `Men`
14. Should admin pool setup show category before division? yes

## Recommended Defaults

- Add `category: 'Women' | 'Men' | 'Coed' | 'RevCo'` to `PoolState`.
- Keep `division` as the existing skill/rating field.
- Default missing category to `Men`.
- Put `Category` before `Division` in Pool Setup.
- Side menu supports selecting entire categories and individual category+division leaves.
- URL filter should become explicit: `category` and optional `division`.
- Dashboard category sections should default open when showing all pools.
- Favorites should keep the same category/division grouping for consistency.
- Publish action should target category+division groups, not all pools with the same division across categories.
- Seeded import should apply the selected category to every generated pool.
- CSV import should not add a category column in v1; full event CSV import defaults pools to `Men`.
- OCR should not infer category in v1.

## Final Implementation Decisions

- Use `POOL_CATEGORY_OPTIONS = ['Women', 'Men', 'Coed', 'RevCo']`.
- Add `category` to the pool model, frontend normalization, backend sanitization, and local defaults.
- Normalize any missing/unknown category to `Men`.
- Use separate `category` and `division` URL params for filtering.
- Side menu category sections include `All Women`, `All Men`, `All Coed`, `All RevCo` plus each division leaf.
- Dashboard groups category first, then division. Category sections default open.
- Favorites preserve the same category/division grouping.
- Publish hidden pools by category+division.
- Manual setup and seeded setup expose category before division.
- Seeded import uses the selected category for all generated pools.
- Full event CSV import defaults imported pools to `Men`.
