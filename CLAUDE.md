# Agent Working Instructions

## Current Status

As of 2026-07-01:

- **Solver**: Tiers 1–14 fully passing (100%, 1625/1625). Tier 13 covers `gap` (implemented 2026-07-01, including line breaking, free-space math, and inter-line spacing); Tier 14 locks `minHeight`/`maxHeight` on both axes. **The pass rate only covers properties the generator emits** — see Known gaps below before trusting a "complete" claim.
- **Packaging**: v1 build, smoke test, and README exist, but the package is **not published to npm** (naming is an open question in PROJECT.md). The README's install instructions describe the post-publish state.
- **Demos**: only the Layout Explorer is built (`pages/demos/explorer.html`, verified working). `DEMOS_PROMPT.md` specifies the remaining five demos.
- **Phase 3 (CSS Grid)**: unstarted. `src/types.ts` declares grid properties, but the solver and the fixture generator have no grid support.

Performance targets are all met:

- 100 nodes / 2 levels: ~0.06ms (target <1ms)
- 1,000 nodes / 3 levels: ~1.1ms (target <5ms)
- 10,000 nodes / 5 levels: ~14ms (target <50ms)

Run `npm run bench` to check performance. All other infrastructure (fixture runner, generator, regression lock, probe) is built.

### Known gaps (verified 2026-07-01, post gap/min-max-height work)

- **`align-items: baseline` is unimplemented** — accepted by the types, absent from the solver, zero fixtures. Tracked as an open question in PROJECT.md. The README notes this.
- **`height: "min-content"` / `height: "max-content"` have zero fixture coverage.** The generator only emits keyword sizes for tier-8 container *widths* (~17 fixtures); keyword heights and keyword sizes on flex items are never generated, so the solver's behavior there is unlocked.
- **Literal `"auto"` strings for `width`/`height`/`flexBasis` are never generated.** The solver treats any non-number as auto, so omission covers the same code path; this is a vocabulary-completeness note, not a correctness risk.
- **Block containers with children are only covered as roots (Tier 1).** A `display: block` node with children nested inside a flex tree is never generated; the solver's block path (no margin collapse) is unlocked in that position.

The general lesson: the fitness metric's coverage boundary is the generator's property vocabulary. When adding any property to `types.ts` or the README, add it to the generator first so fixtures can falsify the implementation. Tier 14 proved the point: locking `minHeight`/`maxHeight` immediately exposed three real solver bugs (cross-axis min/max clamping missing entirely, line cross sizes computed from unclamped values, and hypothetical main sizes unclamped during line breaking).

### One-time machine setup

The probe and fixture generator launch Chrome via Puppeteer. If `npm run probe` fails with "Could not find Chrome", run:

```bash
npx puppeteer browsers install chrome
```

### Verifying browser work (demos)

The chrome-devtools MCP server is available for driving a live browser (navigation, console messages, screenshots). Use it to verify demo and page work visually — never build browser UI blind. `npm start` serves the demos; vite's root is `pages/`, so the explorer is at `http://localhost:5173/demos/explorer.html`.

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
