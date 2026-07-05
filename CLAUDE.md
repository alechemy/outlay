# Agent Working Instructions

## Current Status

As of 2026-07-05:

- **Solver**: Tiers 1–28 fully passing (100%, 3460/3460). Tier 28 locks auto-repeat grids whose inline size is derived from a flex parent (stretched and fit-content widths, incl. the intrinsic-height reorder that sizes auto-fill columns before rows). Tier 25 locks constant-size `measureContent` items inside grid cells; tiers 26–27 lock **width-dependent text** (Phase 2). Tiers 1–17 are flexbox/block/positioning (tier 13 `gap`, 14 min/max-height, 15 baseline, 16 keyword sizing, 17 block-in-flex). Tiers 18–24 are CSS Grid: 18 fixed tracks + explicit placement (incl. fixed-count `repeat`), 19 `fr` sizing with content-based minimums, 20 intrinsic tracks (`auto`, `minmax()`, keyword tracks), 21 spans + sparse auto-placement + implicit tracks, 22 alignment (`justifyItems`/`justifySelf`, grid `alignItems`/`alignSelf`, `justifyContent`/`alignContent` distribution, dense packing, auto margins), 23 mixed trees (grid⊂flex, flex⊂grid, grid⊂grid, grid intrinsic sizing), 24 `repeat(auto-fill/auto-fit)` incl. `minmax(px, 1fr)` and empty-track collapse. Tiers 26–27 lock text via captured word widths + greedy line breaking: 26 text in flex (row/column, grow/shrink, wrap, `min-width:auto` floor from the widest word); 27 text in grid (auto rows sized by wrapped text at the resolved column width, fit-content vs stretched columns). **The pass rate only covers properties the generator emits** — see Known gaps below before trusting a "complete" claim.
- **Packaging**: v1 build, smoke test, and README exist, but the package is **not published to npm** (naming is an open question in PROJECT.md). The README's install instructions describe the post-publish state.
- **Demos**: all six from `DEMOS_PROMPT.md` are built, plus the Text-driven layout demo, all linked from the landing page (`pages/demos/index.html`). Two have committed headless verify scripts: Layout Explorer (`explorer.html`, flex + grid controls, `verify:explorer` 50/50) and Text-driven layout (`text-layout.html`, `verify:text-demo` 11/11), which wires the Pretext adapter (`pages/demos/pretext-adapter.ts`) into a live card grid. The other five were verified live via the chrome-devtools MCP (navigate, interact, screenshot, console): Animated Transitions (`transitions.html` — solver-computed before/after frames tweened with rAF), Drag-and-Drop Reorder (`drag-reorder.html` — grid re-solved per pointer-move, `transform` glide), Virtual Scroll (`virtual-scroll.html` — 10k rows solved once, Pretext row heights, ~16 DOM nodes at any scroll), Nested Dashboard (`dashboard.html` — ~110-node flex+grid tree with a solver-vs-native-CSS toggle matching at ≤0.01px, responsive column reflow), and Server-Side Layout (`pages/demos/server-layout/generate.ts`, `npm run demo:server-layout`, commits `example-output.svg`). Shared box palette in `pages/demos/palette.ts`. Vite resolves the vendored `pretext/` tree from source via a plugin in `vite.config.ts` (no build step; import `@chenglou/pretext`).
- **Phase 3 (CSS Grid)**: complete (tiers 18–25, incl. auto-repeat and constant content in cells). Grid module is `src/grid.ts` (placement, track sizing, alignment math); `src/solver.ts` integrates it in `processNode`/`emitBoxes` and `computeIntrinsicContentSize`.
- **Flagship example**: `examples/layout-assertions/` — a self-contained vitest package (own `package.json`, imports the built `dist/`) demonstrating layout assertions in component tests: assertion helpers over `LayoutResult`, a `sweep(widths, buildTree, invariant)` responsive-sweep utility, a Node-safe greedy text measurer (`text-metrics.ts` + `word-metrics.json`, mirroring the fixture runner), a responsive card grid, and a regression guard. Run with `npm run test:example` (builds `dist/`, installs the example, runs vitest). Root README has a "Testing layouts" section.

Performance targets are all met:

- 100 nodes / 2 levels: ~0.06ms (target <1ms)
- 1,000 nodes / 3 levels: ~1.1ms (target <5ms)
- 10,000 nodes / 5 levels: ~14ms (target <50ms)

Run `npm run bench` to check performance. All other infrastructure (fixture runner, generator, regression lock, probe) is built.

### Known gaps and non-goals (verified 2026-07-05, post grid tiers 18–23)

Grid non-goals for v-grid-1 (deliberately excluded; the generator never emits them):

- **Percentage tracks and sizes** — caller-resolvable against a definite container, consistent with the rest of the vocabulary (no percentages anywhere in `LayoutNode`).
- **Named lines and `grid-template-areas`** — statically resolvable to line numbers by the caller.
- **Subgrid and masonry** — Taffy lacks both as well; explicitly out of scope.
- **Grid baseline alignment** — `alignItems`/`alignSelf: baseline` in a grid container is treated as `start`; never generated.
- **`alignContent: space-evenly`** — absent from the shared alignContent union (flex lacks it too).
- **Implicit tracks before the explicit grid** — negative lines resolve within the explicit grid only; placements that would create leading implicit tracks are never generated.
- **Absolutely-positioned grid children** — positioned against the grid container's padding box like any other container; grid-line-based inset resolution for absolute children is not implemented and not generated.
- **`order` in grid auto-placement** — items place in document order; `order` is only generated for flex.

Flex/block non-goals (deliberately not implemented; the generator avoids them, so no fixture asserts them):

- **Block margin collapse.** Inside a flex item's block subtree Chromium collapses adjacent sibling vertical margins (parent/child collapse is suppressed because a flex item is a BFC root). The solver sums margins instead. Tier 17 sidesteps this by giving every block-flow box zero vertical margins.
- **Block auto-height.** The solver never sizes a `display: block` container to fit its children; a block container with `height: auto` resolves to content-height 0. Block containers must carry a definite height (Tier 1 and Tier 17 both do).
- **Block-container intrinsic min-content.** A `display: block` flex item that must *shrink* below its definite size needs its content's min-content (transferred from its block children); the solver has no block intrinsic sizing, so Tier 17 keeps block containers non-shrinking (`flexShrink: 0`). Empty flex items and block *leaves* shrink correctly (min-content 0).
- **`flexBasis: "content"` with a definite main size.** The solver treats any non-number `flexBasis` as `auto` (uses the main-size property), whereas `content` ignores the specified size. Only ever generated on content-less/definite-size-less items (Tier 8), where the two coincide.

Known solver bug (unfixed, surfaced by the flagship example 2026-07-05, no fixture yet):

- **Nested flex-wrap container auto cross size counts only the first line.** A `flexWrap: wrap` container whose cross size is indefinite (it is a flex item whose content-based main size the parent asks for) reports a cross size covering only its first flex line when its items wrap onto multiple lines. Item positions within it are correct (wrapped items land on the right lines); only the container's own auto cross size is under-computed, so it (and its ancestors) under-size vertically. A **root** wrap container sizes correctly — the bug is in the nested content-based path (`computeIntrinsicContentSize` / hypothetical main size of a wrap child), which does not run the wrap and sum line cross sizes. Minimal repro: a `flexDirection: column` parent (definite width) containing a `flexWrap: wrap` row of fixed-size children wide enough to wrap — Chromium sizes the row to all lines, the solver to one. The generator never emits a nested wrap container with an indefinite cross size, so no fixture falsifies it. The `examples/layout-assertions/` card grid deliberately keeps its CTA row within a single-line budget and asserts single-row from item positions to avoid depending on the buggy value.

Remaining coverage note:

- **Baseline nested containers** derive their first baseline from their first in-flow item recursively; Tier 15 keeps those nested containers at cross-start alignment (default/stretch) with definite-height children, which is where `computeBaselineOffset` is exact. Baseline items whose first descendant is centered/flex-end-aligned inside the nested container are not generated.
- **Nested width-dependent text is implemented (tier 29)** via `containerHeightAtWidth` — block-axis intrinsic sizing lays the subtree out at the known inline size (Pretext pattern 1), gated to width-dependent subtrees (`subtreeHasWidthDependentContent`: a non-constant `measureContent` or an auto-repeat template) so constant-content paths keep the plain intrinsic math. Non-stretched flex children now size their inline axis as fit-content (`usedInlineSize`), matching grid items. One known-failing fixture remains, deliberately kept unlocked: `tier-29-290069` (mean error 1.3px). Diagnosis so far: Chromium quantizes `min-width:auto` text floors to LayoutUnit (1/64px — expected 72.921875 vs our raw 72.9296875), and a nested row-flex's height contribution wraps one line taller in our solver than Chromium inside a stretched grid row (205 vs 195 line cross), inflating the row. Needs probe-based reverse engineering with real text; do not lock or regenerate tier 29 until fixed.

The general lesson: the fitness metric's coverage boundary is the generator's property vocabulary. When adding any property to `types.ts` or the README, add it to the generator first so fixtures can falsify the implementation. Tier 14 proved the point: locking `minHeight`/`maxHeight` immediately exposed three real solver bugs (cross-axis min/max clamping missing entirely, line cross sizes computed from unclamped values, and hypothetical main sizes unclamped during line breaking).

### One-time machine setup

The probe and fixture generator launch Chrome via Puppeteer. If `npm run probe` fails with "Could not find Chrome", run:

```bash
npx puppeteer browsers install chrome
```

### Verifying browser work (demos)

The chrome-devtools MCP server is available for driving a live browser (navigation, console messages, screenshots). Use it to verify demo and page work visually — never build browser UI blind. `npm start` serves the demos; vite's root is `pages/`, so the explorer is at `http://localhost:5173/demos/explorer.html`.

The explorer renders a live browser-CSS reference pane next to the solver pane and shows a match badge (`#match-status`) comparing them at 0.5px tolerance. `npm run verify:explorer` drives the demo's controls in headless Chromium (starts its own vite on port 5199) and fails if any step's badge reports a mismatch — run it after touching the demo or the solver.

---

## Ground Truth Hierarchy

**Read this before anything else. It overrides any instinct to reason from the spec.**

1. **Fixture `expected` values are the ground truth.** They are measurements captured directly from Chromium via `getBoundingClientRect()`. They are not derived from the spec.
2. **Chromium is the authority for anything not covered by a fixture.** Use `npm run probe` to render edge cases directly in Chromium.
3. **The W3C spec is a secondary reference only.** Chromium does not implement the spec 1:1. When they disagree, match Chromium. Never argue with a fixture or probe result by citing the spec.

**Probe before reasoning.** If you find yourself writing more than two sentences about what Chromium "should" do for an edge case, stop — you are guessing. Run the probe and get the actual answer before writing any code.

---

## The Iteration Loop

```
1. Run the full test suite: npm run test
2. Read tests/last_run_failures.log for full failure details.
3. If the current tier is 100% passing, generate fixtures for the next tier and advance.
4. Otherwise, pick the highest-priority failing test (lowest tier, fewest nodes, smallest error).
5. Probe the fixture: npm run probe -- --fixture fixtures/tier-N-XXXXX.json
6. Build a minimal reproduction if needed to isolate the behavior.
7. Identify which module's output first diverges from expected.
8. Make the smallest change that fixes it.
9. Run the full suite. If fitness score improved, commit. If it regressed, git stash pop and try again.
10. Return to step 1.
```

---

## Tools

### Running Tests

```bash
npm run test
```

- Console output is a summary: totals, fitness score, tier breakdown, top 5 failing tests.
- Full per-fixture error details are in `tests/last_run_failures.log` — read this file when diagnosing failures.

### Generating Fixtures

```bash
npm run generate -- --tier 10 --count 200
```

Before re-running after fixture generation, clear the new tier from `locked_tests.json` to avoid false regressions:

```bash
cat tests/locked_tests.json | jq '[.[] | select(startswith("tier-10") | not)]' > /tmp/locks.json && mv /tmp/locks.json tests/locked_tests.json
```

### Regression Behavior

When a locked test regresses, the runner **stashes** (not discards) `src/` via:

```
git stash push -m "regression-<timestamp>" -- src/
```

Then exits 1. Run `git stash pop` to recover the work and keep refining.

---

## Chromium Probe Tool

Use `npm run probe` to render HTML or a LayoutNode tree in live Chromium and read back computed box values.

```bash
# Re-render an existing fixture and diff against its saved expected values
npm run probe -- --fixture fixtures/tier-3-30042.json

# Pipe an HTML snippet via stdin
echo '<div id="root-node" style="display:flex; width:300px">...</div>' | npm run probe

# Render a LayoutNode JSON file (same format as fixture "input")
npm run probe -- --json path/to/node.json

# Get raw JSON output
npm run probe -- --fixture fixtures/tier-3-30042.json --json-out
```

**Always probe the actual fixture first.** Run `npm run probe -- --fixture` before building any manual reproduction. Manual reconstructions introduce transcription errors that cause confusing disagreements.

**Laid-out size vs. intrinsic size.** The probe shows each element's _final computed_ size in context — after flex distribution has run. To see a subtree's _intrinsic_ (unconstrained) size, wrap it in an inline-flex container:

```bash
echo '<div style="display:inline-flex"><div id="root-node" ...>...</div></div>' | npm run probe
```

---

## Fitness Metric

```
fitness = (passing tests / total tests) + (1 / (1 + mean_error_across_failing_tests))
```

The first term dominates. The second provides gradient signal when no tests are flipping. A change that reduces mean error from 4.1px to 3.2px improves the score even if no test changes from fail to pass — commit it.

If the fitness score hasn't improved in 20 consecutive iterations, try the stall recovery strategies below.

---

## Stall Detection and Recovery

Try these in order:

1. **Property isolation**: Strip the simplest failing test to the minimum properties that reproduce it.
2. **Reference comparison**: Run Yoga or Taffy against the failing case and compare intermediate values.
3. **Chromium probing**: Probe the fixture and a minimal reproduction. The probe result is the answer — not the spec.
4. **Spec re-reading**: After confirming Chromium's behavior via probing, read the relevant spec section to understand the algorithm. Validate conclusions against Chromium output, not spec language.
5. **Architectural pivot**: If the module's approach is fundamentally wrong, restructure it rather than patching.
6. **Escalate**: After 40 iterations with no improvement, flag for human review.

---

## Pretext Reference Guide

Pretext (`pretext/`) is a DOM-independent text measurement library in this repo. It solves a structurally similar problem and contains several patterns directly applicable to flexbox layout.

### Patterns Worth Studying

**1. Intrinsic size as a degenerate layout pass** (`pretext/src/line-break.ts`)

Pretext computes min/max-content widths by calling the same layout algorithm with different constraints — not a separate code path. Apply this in `determineMainSize`: when a flex item has `width: min-content` or `width: max-content`, call `solveLayout` on the subtree with `width: Infinity` and read the extent. Don't write a separate intrinsic-sizing code path.

**2. Non-materializing walkers** (`pretext/src/line-break.ts`)

Pretext provides walkers that compute statistics without building output objects. Apply this to the flex length resolution loop: the iterative clamping loop (§9.7 step 6) runs many tentative passes. Compute free space distribution without writing final positions until convergence.

**3. Two-phase separation** (`pretext/src/layout.ts`)

Pretext separates expensive measurement (`prepare()`) from fast layout (`layout()`). The equivalent here: call all `measureContent` callbacks and cache results before the flex algorithm starts. Never call them during the iterative clamping loop.

**4. Named Chromium-specific constants** (`pretext/src/measurement.ts`, `EngineProfile`)

When you can't reconcile a fixture with the spec, the answer is usually a Chromium-specific behavior. Encode it as a named constant — the way Pretext names `lineFitEpsilon` — rather than a magic number.

**5. Accuracy snapshots as regression gates** (`pretext/accuracy/`)

Pretext's committed accuracy snapshots are the same pattern as `tests/locked_tests.json`. See `pretext/pages/accuracy.ts` for how it sweeps and compares.

### Where Not to Look

- `pretext/src/analysis.ts` — text segmentation, not relevant.
- `pretext/src/bidi.ts` — Unicode bidi algorithm, not applicable.
- `pretext/src/rich-inline.ts` — inline flow, out of scope for Phase 1.
