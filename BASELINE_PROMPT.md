# Session Prompt: Implement `align-items: baseline`

Read `CLAUDE.md` first (ground truth hierarchy, iteration loop, known gaps). This session implements the last flexbox value the types accept but the solver ignores: `baseline` for `alignItems`/`alignSelf`. Everything stays local: no `git push`, no npm publish.

## Baseline

Run `npm run test` and confirm all tiers green (1625/1625 across Tiers 1–14 as of 2026-07-01). Run `npm run verify:explorer` and confirm 31/31 steps match the browser.

## Current state

- `types.ts` accepts `"baseline"` for both `alignItems` and `alignSelf`; the README notes it is not implemented.
- The solver silently treats it as `flex-start`: the alignment switch in `emitBoxes` (`src/solver.ts`) has no `baseline` case, so it falls through to the default. The stretch check in Phase 6 compares against `"stretch"` exactly, so baseline items correctly don't stretch — the only missing piece is baseline grouping and offset math.
- Zero fixtures cover it. The generator never emits it.

## Work order

### 1. Probe Chromium first — do not reason from the spec

The solver's nodes have no text; Chromium synthesizes baselines for such boxes. Probe (`npm run probe`, stdin HTML) at minimum:

- Empty fixed-height items of differing heights: where does the synthesized baseline sit relative to the border box?
- Items with differing `padding-bottom` / `border-bottom` / `margin-bottom` — which edges shift the baseline?
- A nested flex container as a baseline item (Chromium derives its baseline from its first line / first item).
- `baseline` in column direction (expect fallback behavior — verify what Chromium actually does).
- Multi-line wrap with baseline items (baseline groups are per-line).
- `alignSelf: baseline` on a subset of items while the container uses another `alignItems` value — baseline-group items align to each other; others follow their own alignment.
- A `measureContent` item, if it behaves differently from an empty box.

Record the findings as comments in the session or as named constants if Chromium-specific (see Pretext pattern 4 in CLAUDE.md).

### 2. Generator + fixtures before solver code

Add `"baseline"` to the generator's `alignItems`/`alignSelf` vocabulary in a new tier (~100 fixtures). Take the next unused tier number (`ls fixtures | grep -o 'tier-[0-9]*' | sort -Vu | tail -1`) and update PROJECT.md's Phase 3 grid-tier reservation to start after it. Items need varied heights, padding, border, and margins so baselines actually differ; include nested containers, wrap, and mixed `alignSelf` values. Clear the new tier from `tests/locked_tests.json` per CLAUDE.md before re-running.

### 3. Solver implementation

Known integration points in `src/solver.ts`:

- Per-line baseline computation: before positioning, compute each baseline item's ascent (baseline offset from its cross-start margin edge, per the probe findings) and the line's max ascent.
- `emitBoxes` cross-offset switch: baseline items get `maxAscent - itemAscent` (+ margins as the probe dictates).
- Phase 5.5b line cross size: a line containing baseline items is at least `maxAscent + maxDescent`.

Iterate per the loop until the new tier is 100% with zero regressions in all prior tiers.

### 4. Surface it

- Add `"baseline"` to the explorer's `alignItems` options (`pages/demos/explorer.ts`) — the browser-CSS reference pane and match badge then verify it live for free. Add an alignItems-baseline step to `scripts/verify-explorer.ts` and confirm it passes.
- README: remove the "accepted but not implemented" caveat.
- CLAUDE.md: drop the baseline entry from Known gaps.
- PROJECT.md: resolve the baseline open question; update tier numbering.

## Acceptance criteria

- New baseline tier 100%, all prior tiers still 100%, `npm run bench` targets still met.
- `verify:explorer` passes including a baseline step.
- README/CLAUDE.md/PROJECT.md updated; no claim without fixtures behind it.
- Single-line commits in the existing `feat:`/`fix:` style, committed per fitness improvement.
