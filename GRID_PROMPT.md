# Session Prompt: Phase 3 — CSS Grid

Read `CLAUDE.md` first (ground truth hierarchy, iteration loop) and PROJECT.md's Phase 3 section. This is the largest remaining phase; expect multiple sessions. Everything stays local: no `git push`, no npm publish.

## Baseline

Run `npm run test` and confirm all pre-grid tiers green (1625/1625 across Tiers 1–14 as of 2026-07-01; later sessions may have added baseline/coverage tiers — all must be green). Run `npm run bench`; the performance targets in CLAUDE.md apply to grid trees too.

## Current state

- `src/types.ts` already declares the grid vocabulary: `TrackSize`, `TrackDefinition`, `gridTemplateColumns/Rows`, `gridAutoRows/Columns`, `gridAutoFlow` (incl. `dense`), `gridColumn/Row` placement, `display: "grid"`. The solver and generator have zero grid support; `display: "grid"` nodes currently fall through to the block path.
- Missing from the types: `justifyItems`/`justifySelf` (grid-specific alignment). Decide early whether v-grid-1 ships without them (document) or adds them (types → generator → solver, in that order).
- `gap` is implemented for flex; grid reuses the same property but needs its own application in track layout.

## Ground rules (same as flex, they bear repeating)

1. **Generator vocabulary first.** No grid property lands in the solver before the generator can emit it and fixtures can falsify it. This is the project's core lesson.
2. **Probe before reasoning.** Chromium's grid track sizing (especially `auto` tracks and intrinsic contributions) diverges from a naive spec reading. `npm run probe` with stdin HTML is the arbiter.
3. **Fixture tiers are append-only.** Grid takes six consecutive tiers starting after the last existing tier (check `ls fixtures | grep -o 'tier-[0-9]*' | sort -Vu | tail -1`); update PROJECT.md's reservation to the actual numbers.

## Suggested tier progression (one tier per step, iterate to 100% before advancing)

1. **Fixed tracks, explicit placement**: px-only `gridTemplateColumns/Rows`, items placed by explicit line numbers, `gap`, padding/border/box-sizing variety. This isolates the coordinate math.
2. **`fr` units**: free-space distribution across fr tracks, mixed px+fr, fr with gap (mirrors the flex free-space lesson — gaps come off before distribution).
3. **`auto` tracks and `minmax()`**: intrinsic track sizing from item contributions. This is the hard one — probe extensively; reuse `computeIntrinsicContentSize` where possible (Pretext pattern 1: intrinsic sizing as a degenerate layout pass, not a parallel code path).
4. **Spans and auto-placement**: `span n`, auto-placement in `row`/`column` flow, implicit tracks via `gridAutoRows/Columns`.
5. **`dense` packing + alignment**: dense auto-flow, `alignItems`/`alignSelf` (and `justifyItems`/`justifySelf` if added) inside grid areas, stretch vs fixed-size items.
6. **Mixed trees**: grid inside flex, flex inside grid, nested grids — PROJECT.md requires the two to compose.

## Architecture

Add a grid module (e.g. `src/grid.ts`) that plugs into the existing tree walk rather than a parallel solver: `processNode` and `emitBoxes` branch on `display === "grid"` the way they do for flex today. Reuse `resolveBoxModel`, the box-model maps, `parentResolvedDims`, and the min/max clamping helpers — grid items obey the same clamps. Track sizing state can mirror `containerLineLayouts`. If the flex-centric structure fights back, restructure (stall-recovery rule 5) rather than patching.

## Verification beyond fixtures

- After each tier: full suite (zero flex regressions — grid work touches shared code), `npm run bench`.
- Extend the explorer demo with grid controls once tracks + placement work, and add grid steps to `scripts/verify-explorer.ts` — the browser-CSS reference pane gives free live verification against real CSS Grid.

## Acceptance criteria (per session, not just at the end)

- Every completed tier at 100% with all earlier tiers green; commit per fitness improvement, single-line messages, existing style.
- PROJECT.md Phase 3 checklist items ticked as they land; tier numbering kept accurate.
- README "What's supported" gains grid claims only for fixture-backed behavior; anything punted goes to CLAUDE.md Known gaps.
