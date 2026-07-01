# Session Prompt: Close the Solver Coverage Gaps

Read `CLAUDE.md` first (ground truth hierarchy, iteration loop, known gaps). This session closes the verified gaps between what the library claims and what the solver + fixture corpus actually cover. Everything stays local: no `git push`, no npm publish.

## Baseline

Before changing anything, run `npm run test` and confirm 1375/1375 passing. If the probe errors with "Could not find Chrome", run `npx puppeteer browsers install chrome` (see CLAUDE.md one-time setup).

## Work order

### 1. Fix the probe's shorthand crash (small, do first — everything else depends on the probe)

`npm run probe -- --json <file>` crashes with `Cannot read properties of undefined (reading 'top')` when the input uses number shorthand for `padding`/`margin`/`border`. `toHTML` in `scripts/probe-chromium.ts` predates shorthand support and requires full BoxSides objects. Normalize shorthand inputs the same way `src/solver.ts` does before converting to CSS. Verify with:

```json
{
  "id": "root-node", "display": "flex", "width": 500, "height": 400,
  "padding": 12, "gap": 8,
  "children": [
    { "id": "a", "width": 80, "flexGrow": 1 },
    { "id": "b", "width": 80, "flexGrow": 2 },
    { "id": "c", "width": 80, "flexGrow": 1 }
  ]
}
```

### 2. Implement `gap` (the main task)

`gap` is declared in `types.ts` and claimed in the README, but `src/solver.ts` never reads it and zero fixtures cover it. Ground truth for the tree above (verified in Chromium 146): children are 135/190/135 wide at x = 0/143/341. The current solver wrongly returns 139/198/139 at 0/139/337.

Order of work — fixtures before solver code:

1. Add `gap` to the fixture generator's property vocabulary: number form and `{ row, column }` object form, mapped to CSS `gap` / `row-gap` + `column-gap`. Cover: row and column directions, reverse directions, `wrap` and `wrap-reverse` (gap participates in line breaking and cross-axis line spacing), grow and shrink under gap-reduced free space, gap combined with `justify-content` spacing values, gap with padding, and nested containers with differing gaps.
2. Generate a new Tier 13 (~150 fixtures): `npm run generate -- --tier 13 --count 150`. Clear tier-13 entries from `tests/locked_tests.json` per CLAUDE.md before re-running tests.
3. Implement gap in the solver via the standard iteration loop until Tier 13 is 100% with zero regressions in Tiers 1–12. Known integration points: available main-space and free-space math in `resolveFlexibleLengths`, line collection under wrap (`collectIntoLines`), main-axis positioning, cross-axis line positioning (row-gap between flex lines), and `computeIntrinsicContentSize` (gaps contribute to min/max-content sizes — probe Chromium for exact behavior rather than reasoning from the spec, especially min-content under wrap).

Note on tier numbering: PROJECT.md reserved Tiers 13–18 for grid. Gap takes 13 and min/max-height takes 14; update PROJECT.md's Phase 3 section to start grid at Tier 15.

### 3. Lock `minHeight`/`maxHeight` behavior (coverage only)

The solver implements these and a manual Chromium comparison passes, but the generator only randomizes `minWidth`/`maxWidth`, so no fixture covers the height variants. Add them to the generator vocabulary (column-direction trees make them main-axis constraints, row-direction trees make them cross-axis constraints — cover both) and generate Tier 14 (~100 fixtures). Expect this to pass mostly or entirely without solver changes; fix anything it flips.

### 4. Vocabulary audit (cheap, prevents recurrence)

Diff the property names in `src/types.ts` against what `tests/generator.ts` can emit. Report anything else claimed-but-never-generated. Known and deliberately out of scope: `align-items: baseline` (unimplemented, open question in PROJECT.md), grid properties (Phase 3). If the audit finds others, add coverage or list them in CLAUDE.md's Known gaps — do not leave silent.

### 5. True up the docs

After gap ships: update README ("What's supported") so every claim is fixture-backed, note that `align-items: baseline` is accepted by the types but not implemented, and rewrite CLAUDE.md's Known gaps section to reflect what this session fixed. Update the fixture/tier counts in README and CLAUDE.md.

### 6. Verify the explorer demo visually

`npm start` serves the demos (vite root is `pages/`; explorer at `http://localhost:5173/demos/explorer.html`). Use the chrome-devtools MCP to load it, confirm the default tree renders 135/190/135 with visible 8px gaps, drag the gap slider and confirm the layout responds, and screenshot the result. Do not claim the demo works without having looked at it.

## Acceptance criteria

- Full suite green: all 12 original tiers plus new Tiers 13–14, zero regressions.
- The probe round-trips shorthand JSON without crashing.
- Explorer demo visually verified with gap working.
- README/CLAUDE.md claims match fixture-backed reality.
- Commits follow the iteration-loop convention (commit on fitness improvement); single-line messages matching the existing `feat:`/`chore:` style.
