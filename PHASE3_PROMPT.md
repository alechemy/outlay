# Session Prompt: Phase 3 — Flagship Consumer: Layout Assertions in Component Tests

Read `CLAUDE.md` first. Everything stays local: no `git push`, no npm publish.

## Why this consumer (decided in the 2026-07-05 strategy review)

The venue where a pure-JS, synchronous, zero-WASM layout engine is *uniquely* necessary — not merely convenient — is *layout assertions inside unit/component tests*: jsdom computes no layout at all; WASM engines need async init inside test runners; spinning up Playwright for "does this overflow at 375px" is a sledgehammer. OG-image generation was explicitly rejected as the flagship (Takumi owns that lane). Synchronous solving also makes *responsive sweeps* cheap: hundreds of widths per test in milliseconds.

## Deliverable: `examples/layout-assertions/`

A self-contained example package (own `package.json`, vitest as devDependency, imports the library via a relative path the way the package smoke test does). Contents:

1. **`helpers.ts`** — assertion utilities over `LayoutResult`:
   - `boxOf(result, id)` (throws with a useful message if missing)
   - `overlaps(a, b)` / `assertNoOverlaps(result, ids)`
   - `within(child, parent)` and `assertContained(result, parentId, childIds)`
   - `overflowsX(result, parentId)` / `overflowsY(...)` (any child border box outside the parent's content box)
   - `sweep(widths, buildTree, invariant)` — solve at each width, collect failures with the offending width in the message. This is the signature capability; make it read well.

2. **`text-metrics.ts`** — Node-safe text measurement: a greedy line breaker over precomputed per-word advance widths (same contract as the fixture runner's; ~20 lines) plus one small committed JSON of word metrics for the demo strings. State plainly in a doc comment-free way (README, not comments) that this mirrors what a Pretext-backed `measureContent` returns in the browser.

3. **`card-grid.test.ts`** — a realistic component layout model: header + responsive card grid (`repeat(auto-fill, minmax(220px, 1fr))`) of text cards with a footer CTA row. Assertions:
   - no horizontal overflow at any width in `sweep(320..1280 step 20)`
   - no card overlaps at any width
   - the CTA row never exceeds one row height (i.e. buttons don't wrap) above 360px
   - column count changes at the expected breakpoints (derive expected from the minmax math, don't hardcode magic)
   - a timing line: log the whole sweep's wall time (should be a few ms) — this is the pitch.

4. **`regression.test.ts`** — the "what it catches" demo: a layout constant (e.g. a fixed sidebar width) that, if increased past a threshold, makes an invariant fail. Ship it passing at the good value, and include a commented-out?? — NO comments: instead express it as a test that asserts the failure is detected: run the invariant against the known-bad value and expect `sweep` to report failures. That shows the tool catching a real bug without narrating.

5. **`README.md`** (example-local) — the pitch, quick start, and honest scope: you are testing your *layout model* (the LayoutNode tree your code produces), not rendered DOM; text metrics must be precomputed for Node (canvas-less) or supplied by Pretext in browser-based runners.

## Root-repo wiring

- Root README: add a "Testing layouts" section — one compact `sweep` snippet, link to the example.
- `package.json`: add `"test:example"` script that runs the example's vitest (`npm --prefix examples/layout-assertions test` or equivalent). Run it in the session and make it pass.
- CLAUDE.md status: add the example under a new bullet; PROJECT.md: note the flagship shipped.

## House rules

- No modifications to `src/`, `fixtures/`, `tests/` (importing types from `../src/types` in the example is fine; prefer importing the built `dist/` the way the smoke test does if simpler — but then document that `npm run build` must precede `npm run test:example`, and wire the script to build first).
- NO code comments except a one-line non-obvious WHY. Tests should read as documentation via naming, not comments.
- Single-line commits, existing style, no attribution trailers. Never push or publish.
- `rg --color=never` for content searches (grep is hooked off).
- Verify by actually running `npm run test:example` (all tests green, including the detects-the-bad-value test) and paste the timing line in your report.

## Acceptance

- `npm run test:example` green; full fixture suite untouched and still passing (`npm run test` — note tier 29 has one known-failing unlocked fixture, 3579/3580 is the expected baseline; do not "fix" it).
- Docs updated as above; no claim beyond what the example actually demonstrates.
