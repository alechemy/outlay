# Project Scope: Off-DOM Constraint-Based CSS Layout Solver

## Summary

Build a JavaScript/WebAssembly library that answers the question "given these CSS constraints, what size and position will this element have?" without rendering anything in the browser. The library accepts a declarative description of a layout tree (container dimensions, display modes, child constraints) and outputs resolved box dimensions and positions using pure arithmetic.

This is the layout equivalent of what Pretext.js does for text measurement: extracting a historically DOM-dependent computation into a standalone, renderable-anywhere math layer.

---

## Problem Statement

Web developers routinely force browser reflows just to obtain numeric answers: "how tall will this flex container be?", "where will this grid item land?", "will this element overflow?" The browser's layout engine is the only way to resolve CSS constraints today, and querying it (via `getBoundingClientRect`, `offsetHeight`, `scrollHeight`, etc.) triggers synchronous reflow, which blocks the main thread.

This cost shows up concretely in:

- **Virtual scrolling**: Libraries must render hidden elements or guess row heights because they cannot compute flex/grid layout offline.
- **Design tools and visual editors**: Browser-based design tools (Figma-like editors, page builders) must round-trip through the DOM to preview layout changes.
- **Server-side rendering**: Node.js SSR cannot answer layout questions at all, since there is no DOM. Frameworks ship layout assumptions or defer to the client.
- **Testing**: Layout assertions in component tests require a full browser environment (jsdom cannot compute layout).
- **Animation planning**: Computing start/end positions for layout animations requires two separate reflows.
- **Drag-and-drop**: Determining drop targets during a drag operation requires continuous reflow to track element positions.

---

## Project Goals

### Primary Goal

A library that correctly resolves **single-axis Flexbox layout** (the most common layout mode in modern web apps) for a tree of elements with known constraints, producing pixel-accurate\* box positions and dimensions.

\*Pixel-accurate defined as: matching browser output within 0.5px for the supported CSS property subset (sub-pixel precision matters for cumulative error across many nodes).

### Secondary Goals (ordered by priority)

1. CSS Grid layout (explicit grid, fixed and fractional tracks).
2. Block flow layout (normal flow with margin collapsing).
3. Basic intrinsic sizing (`min-content`, `max-content`, `fit-content`).
4. Integration with Pretext.js for text-aware layout solving (i.e., "how tall is this flex item if it contains this paragraph of text at this width?").

### Non-Goals (explicitly out of scope)

- Full CSS spec compliance. This is not a browser engine. The 80/20 subset is the target.
- Rendering or painting. Output is a position/size map, not pixels.
- Inline layout and line breaking (delegate to Pretext or browser).
- Floats. Legacy layout mode, not worth the complexity.
- Table layout. Deeply idiosyncratic algorithm, poor ROI.
- Replaced elements with intrinsic aspect ratios (images, video) beyond basic `width`/`height`/`object-fit`.
- CSS parsing, cascade resolution, or selector matching. The caller provides resolved values.

---

## Technical Requirements

### Input Format

The library accepts a JSON-serializable tree of layout nodes. No DOM objects, no CSSOM, no style strings to parse. The caller is responsible for resolving CSS selectors, cascade, and inheritance before calling the solver. The solver only consumes resolved property values.

```typescript
interface LayoutNode {
  // Identity
  id: string;

  // Box model (all values in px, already resolved from CSS)
  width?: number | "auto" | "min-content" | "max-content";
  height?: number | "auto" | "min-content" | "max-content";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  padding: BoxSides; // { top, right, bottom, left } in px
  margin: BoxSides; // supports "auto" for centering
  border: BoxSides; // widths only, in px
  boxSizing: "content-box" | "border-box";

  // Display and layout mode
  display: "flex" | "grid" | "block" | "none";

  // Flex container properties (when display === "flex")
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  justifyContent?:
    | "flex-start"
    | "flex-end"
    | "center"
    | "space-between"
    | "space-around"
    | "space-evenly";
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
  alignContent?:
    | "flex-start"
    | "flex-end"
    | "center"
    | "stretch"
    | "space-between"
    | "space-around";
  gap?: number | { row: number; column: number };

  // Flex item properties
  flexGrow?: number; // default 0
  flexShrink?: number; // default 1
  flexBasis?: number | "auto" | "content";
  alignSelf?:
    | "auto"
    | "flex-start"
    | "flex-end"
    | "center"
    | "stretch"
    | "baseline";
  order?: number;

  // Grid container properties (Phase 3)
  gridTemplateColumns?: TrackDefinition[];
  gridTemplateRows?: TrackDefinition[];
  gridAutoRows?: TrackSize;
  gridAutoColumns?: TrackSize;
  gridAutoFlow?: "row" | "column" | "row dense" | "column dense";

  // Grid item properties (Phase 3)
  gridColumn?: {
    start: number | "auto";
    end: number | "auto" | `span ${number}`;
  };
  gridRow?: { start: number | "auto"; end: number | "auto" | `span ${number}` };

  // Children
  children: LayoutNode[];

  // Optional: intrinsic content size callback
  // For leaf nodes whose content size is externally determined
  // (e.g., text measured by Pretext)
  measureContent?: (availableWidth: number) => {
    width: number;
    height: number;
  };
}

type TrackDefinition =
  | number
  | "auto"
  | `${number}fr`
  | { min: number | "auto"; max: number | "auto" | `${number}fr` };

interface BoxSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
```

#### Design decision: `boxSizing` is an input property.

The solver accepts `boxSizing` and handles the conversion internally rather than requiring the caller to pre-resolve to content-box values. Rationale: nearly all modern CSS uses `border-box`, so forcing callers to convert would create a friction point and a common source of bugs at every integration site. The conversion math is trivial for the solver to handle.

### Output Format

```typescript
interface LayoutResult {
  boxes: Map<string, ResolvedBox>;
}

interface ResolvedBox {
  id: string;

  // Position relative to the root container's content box origin
  x: number;
  y: number;

  // Final resolved dimensions (content box)
  width: number;
  height: number;

  // Resolved box model edges
  padding: BoxSides;
  border: BoxSides;
  margin: BoxSides; // includes resolved "auto" margins

  // Convenience computed values
  borderBoxWidth: number;
  borderBoxHeight: number;
  outerWidth: number; // borderBoxWidth + margin.left + margin.right
  outerHeight: number;
}
```

### Accuracy Target

The solver must match Chromium's layout output within 0.5px for all supported properties across all passing test tiers. The tolerance is measured per-property per-node (not accumulated).

### Performance Targets

| Tree size    | Nesting depth | Target | Context                  |
| ------------ | ------------- | ------ | ------------------------ |
| 100 nodes    | 2 levels      | < 1ms  | Animation frame budget   |
| 1,000 nodes  | 3 levels      | < 5ms  | Drag operation budget    |
| 10,000 nodes | 5 levels      | < 50ms | Design tool / SSR budget |

These are median times on a 2022-era laptop (Apple M1 or equivalent x86). Measure with `performance.now()`, not `Date.now()`.

---

## Architecture

### Modular Sub-Algorithm Design

The flexbox layout algorithm is specified by the W3C as a series of numbered steps. Each major step is implemented as a separate, independently testable module. This makes it possible to identify which sub-algorithm is producing errors and refine it in isolation.

| Module                       | Spec Section         | Responsibility                                                                                                    |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `resolveBoxModel`            | n/a (pre-processing) | Apply `boxSizing` conversion, resolve padding/border/margin to content-box math                                   |
| `determineFlexContainerSize` | 9.2                  | Resolve the container's main and cross size from its constraints and context                                      |
| `collectFlexItems`           | 9.2                  | Gather children, apply `order`, handle `display: none`                                                            |
| `determineMainSize`          | 9.3                  | Compute hypothetical main size of each flex item                                                                  |
| `collectIntoLines`           | 9.3                  | Single-line or multi-line collection based on `flex-wrap` and available main size                                 |
| `resolveFlexibleLengths`     | 9.7                  | The core flex algorithm: distribute free space or shrink overflow using grow/shrink factors with min/max clamping |
| `resolveCrossSize`           | 9.4                  | Determine cross size of each item and each flex line                                                              |
| `mainAxisAlignment`          | 9.5                  | Apply `justify-content` and auto margins on main axis                                                             |
| `crossAxisAlignment`         | 9.6                  | Apply `align-items`, `align-self`, `align-content`                                                                |
| `resolveAbsolutePositions`   | Phase 2              | Handle `position: absolute/fixed` children                                                                        |

Each module has a clear contract: input type, output type, and what properties it reads vs. modifies.

### Debug Trace

The solver exposes a debug mode that logs output at every module boundary, enabling failures to be traced to a specific sub-algorithm:

```typescript
interface DebugTrace {
  resolvedBoxModels: Map<
    string,
    { contentWidth: number; contentHeight: number /* ... */ }
  >;
  flexItemOrder: string[];
  hypotheticalMainSizes: Map<string, number>;
  flexLines: Array<{ itemIds: string[]; mainSize: number }>;
  resolvedMainSizes: Map<string, number>;
  frozenItems: Map<string, "min-clamped" | "max-clamped" | "flexible">;
  resolvedCrossSizes: Map<string, number>;
  boxes: Map<string, ResolvedBox>;
}
```

### Phase 1: Pure TypeScript

Start with readable TypeScript. No premature optimization. Priority order:

1. Correctness (match Chromium).
2. Clarity (each spec step maps to named code).
3. Performance (only after correctness is solid).

### Phase 2: Optimization

Profile against the benchmark suite. If the 5ms/1,000-node target is not met:

1. First, optimize in TypeScript (avoid allocations in hot loops, use typed arrays for box data, flatten tree traversal into array iteration).
2. If still insufficient, port the `resolveFlexibleLengths` inner loop to Rust/Wasm. This is typically the hottest code path since it iterates repeatedly until convergence.

The API surface remains TypeScript regardless. Only the inner computation moves to Wasm.

### Phase 3: Grid Layout

CSS Grid track sizing is added as a separate set of modules that plug into the same tree-walking infrastructure. Grid and Flex must compose (a grid item can be a flex container and vice versa).

---

## Test Tiers

Tests are organized into numbered tiers of increasing difficulty. All unlocked tiers are always run — regressions in earlier tiers block advancement.

**Tier 1: Static sizing** — Box model math only (padding, border, margin, boxSizing). No flex. ~50 fixtures.

**Tier 2: Basic flex distribution** — `flex-grow` only, row direction, no shrink or min/max constraints. ~100 fixtures.

**Tier 3: Flex shrink and min/max clamping** — `flex-shrink` with overflow, min/max constraints, the clamping-and-refreeze loop. ~150 fixtures.

**Tier 4: Cross-axis alignment** — `align-items`, `align-self`, stretch, column direction. ~100 fixtures.

**Tier 5: justify-content and auto margins** — All `justify-content` variants, `margin: auto` on main axis. ~75 fixtures.

**Tier 6: Flex wrapping** — `flex-wrap`, multi-line containers, `align-content`. ~150 fixtures.

**Tier 7: Nested flex containers** — Flex items that are themselves flex containers, indefinite size resolution, percentage dimensions. ~200 fixtures.

**Tier 8: Intrinsic content sizing** — `measureContent` callbacks, `flex-basis: content`, `min-content`/`max-content`. ~100 fixtures.

**Tier 9: Reverse directions and order** — `row-reverse`, `column-reverse`, `order` property. ~50 fixtures.

**Tier 10: Edge cases and adversarial inputs** — Zero-size containers, deep nesting (10+ levels), all items non-flexible, negative margins, large values, `display: none` interleaved. ~200 fixtures.

**Tier 11: Absolute positioning** — `position: absolute` children of flex containers, inset-based sizing. ~100 fixtures.

**Tier 12: Fixed and nested absolute positioning** — `position: fixed` relative to root, absolute children of `position: relative` intermediates. ~100 fixtures.

**Tier 13: Gap** — `gap` in number and `{ row, column }` forms: row/column/reverse directions, wrap line breaking and inter-line spacing, grow/shrink under gap-reduced free space, interaction with `justify-content`, nested containers with differing gaps. ~150 fixtures.

**Tier 14: Min/max height constraints** — `minHeight`/`maxHeight` as main-axis constraints (column direction) and cross-axis constraints (row direction). ~100 fixtures.

**Tier 15: Baseline alignment** — `align-items`/`align-self: baseline`: synthesized baselines for empty boxes, per-line baseline groups under wrap/wrap-reverse, nested-container baselines, mixed `alignSelf`, column-direction fallback. ~100 fixtures.

**Tier 16: Keyword sizing** — `min-content`/`max-content` on container heights (both axes) and on flex items (widths and heights), mixed with grow/shrink and gap; also exercises literal `"auto"` widths/heights/flex-basis. ~100 fixtures.

**Tier 17: Block containers in flex trees** — `display: block` containers with block/flex children nested as flex items, exercising the block layout path in a non-root position. Definite-size, zero-vertical-margin boxes isolate it from margin collapse (a non-goal). ~75 fixtures.

**Tier 18: Grid fixed tracks** — px-only templates (incl. fixed-count `repeat`), explicit line placement with spans via end lines, gap, auto-height containers, box-sizing variety. ~150 fixtures.

**Tier 19: Grid fr sizing** — free-space distribution across `fr` tracks with content-based minimums (clamp-and-redistribute), fractional factors, fr rows under definite and indefinite heights. ~150 fixtures.

**Tier 20: Grid intrinsic tracks** — `auto`, `minmax()`, and `min-content`/`max-content` tracks: base/growth-limit sizing, the maximize step, equal stretch of auto tracks. ~150 fixtures.

**Tier 21: Grid spans and auto-placement** — `span n`, sparse auto-placement in row/column flow, row-locked items, implicit tracks via `gridAutoRows`/`gridAutoColumns`, span contribution distribution (incl. the flex-track and infinitely-growable rules). ~150 fixtures.

**Tier 22: Grid alignment and dense packing** — `justifyItems`/`justifySelf`, grid `alignItems`/`alignSelf`, `justifyContent`/`alignContent` content distribution with safe fallbacks, dense auto-flow, auto margins (reported as 0 per Chromium). ~150 fixtures.

**Tier 23: Mixed grid/flex trees** — grid inside flex, flex inside grid, nested grids; grid intrinsic sizing feeding flex bases and min-content floors (fr equalization differs between max-content and min-content width constraints). ~150 fixtures.

**Tier 24: Grid auto-repeat** — `repeat(auto-fill)` / `repeat(auto-fit)` with px and `minmax(px, 1fr)` tracks, fixed tracks around the repeat, auto-fill rows, auto-fit empty-track collapse (including gap collapse) observed via content distribution. ~120 fixtures.

**Tier 25: Grid content items** — constant-size `measureContent` items inside grid cells (fixed dimensions independent of available width), across `auto`/`fr`/px tracks, spans, and `justifyItems` variety. ~120 fixtures.

**Tier 26: Text in flex** — width-dependent text items as flex children (row and column direction), grow/shrink around text, wrap where the text item's hypothetical size drives line breaking, `min-width:auto` floored from the widest word. Text measured via captured word widths + greedy line breaking. ~150 fixtures.

**Tier 27: Text in grid** — text-driven track sizing: text items in `auto`/`fr`/`minmax()`/px columns feeding min-content (widest word) and max-content (single line) contributions; auto-height rows sized by wrapped text at the resolved column width; fit-content (`justifyItems: start/center`) vs stretched columns. ~150 fixtures.

**Tier 28: Derived-width auto-repeat grids** — auto-fill/auto-fit grids nested in flex with no explicit width: stretched (column parents), flex-distributed (row parents), and fit-content (non-stretch alignment) inline sizes; intrinsic heights computed at the used inline size. ~120 fixtures.

---

## Prior Art

| Project                         | What to Learn                                                                                                                                            | Watch Out For                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Yoga** (Facebook)             | Architecture, test suite, edge case handling for flexbox. Yoga has thousands of generated test cases that can serve as fixtures after format conversion. | Intentional spec deviations for cross-platform consistency. When Yoga and Chromium disagree, this project follows Chromium.                |
| **Pretext.js** (Cheng Lou)      | Development methodology, API design philosophy, and several directly applicable algorithmic patterns (see Pretext Reference Guide in CLAUDE.md).         | Text-only; no flexbox solving. Adapt patterns conceptually — don't import code.                                                            |
| **Taffy** (Rust)                | Modern Rust flexbox/grid implementation with good spec compliance. Evaluate as a potential Wasm starting point for Phase 2.                              | Rust-native API. Evaluate Wasm bundle size and whether its spec compliance is close enough to justify wrapping rather than reimplementing. |
| **web-platform-tests** (W3C)    | Thousands of official CSS flexbox and grid test cases.                                                                                                   | HTML-based; need automated conversion to the solver's input format. Many test CSS features outside this project's scope.                   |
| **Stretch** (Vislyhq, archived) | Earlier Rust flexbox engine. Yoga-compatible test suite.                                                                                                 | Archived, known spec compliance gaps.                                                                                                      |

---

## Deliverables by Phase

### Phase 1 (Core Flex, Tiers 1-10) — Complete

- [x] Test harness: fixture runner, Chromium-based generator, fitness metric
- [x] Debug trace infrastructure with trace comparator
- [x] Iteration log with regression lock
- [x] TypeScript solver passing Tiers 1-7 at 100%
- [x] TypeScript solver passing Tiers 8-10 at 100%
- [x] Benchmark suite with per-module profiling

Deprioritized from Phase 1:

- Yoga/web-platform-tests fixture conversion pipeline — Chromium-based fixture generator proved sufficient; conversion pipeline adds little value now.
- Taffy evaluation report — TypeScript solver met all performance targets without a Wasm port, making Taffy wrapping moot.

### Phase 2 (Performance + Positioning) — Complete

- [x] Performance optimization pass (all targets met: 100 nodes ~0.06ms, 1k nodes ~1.1ms, 10k nodes ~14ms)
- [x] `position: absolute` and `position: fixed` layout resolution (Tiers 11-12, 1375/1375 passing)
- [x] `margin: auto` centering in both axes

Not needed:

- Wasm port of hot path — TypeScript met all performance targets with large margin.

Deferred to post-v1:

- Integration example with Pretext.js for text-aware layout.

### v1 Release Readiness

The solver is correct and fast. What remains is packaging it for consumption as an npm library. These items follow Pretext's shipping pattern: ESM + `.d.ts` via plain `tsc`, zero runtime deps, a smoke test against the actual tarball.

#### 1. Build system and package shape (blocking)

The solver currently runs via `ts-node` with no `dist/` output. Ship ESM + type declarations the same way Pretext does:

- `tsconfig.build.json` targeting `dist/`, ESM output, declaration emit. Exclude `tests/`, `scripts/`, `fixtures/`.
- `package.json`: `"type": "module"`, `exports` map (`.` → `dist/index.js` + `dist/index.d.ts`), `files` array excluding test/fixture/script artifacts from the tarball.
- `src/index.ts` as the public entry point. Exports: `solveLayout`, `LayoutNode`, `ResolvedBox`, `LayoutResult`, `BoxSides`.
- Move `src/trace-comparator.ts` out of `src/` — it is test infrastructure, not library code.

#### 2. Zero runtime dependencies (blocking)

`htmlparser2` and `taffy-layout` are currently in `dependencies` but are only imported by `scripts/evaluate-taffy.ts` and `scripts/convert-yoga-tests.ts`. Move both to `devDependencies`. The published solver must have zero runtime dependencies — enforce this structurally by ensuring `src/` imports nothing from `node_modules`.

#### 3. README with API docs (blocking)

Following Pretext's README structure:

- Full `LayoutNode` and `ResolvedBox` type signatures.
- Minimal usage example: build a tree, call `solveLayout`, read positions.
- "Non-goals" section (no CSS parsing, no rendering, no floats, no tables — restating what is already in this document's Non-Goals).
- Note that fixtures were captured from Chromium and that re-generating requires a local Chromium install via Puppeteer.
- Accuracy and performance claims with the numbers from the benchmark suite.

#### 4. Package smoke test (blocking)

A script that runs `npm pack`, installs the tarball into a temp directory, imports the public API, calls `solveLayout` with a trivial tree, and asserts the output is correct. This catches build/export issues that the test suite cannot. See `pretext/scripts/package-smoke-test.ts` for the pattern.

#### 5. Package metadata (blocking)

- `package.json`: fill in `description`, `keywords`, `author`, `repository`, `license`.
- Add a `LICENSE` file (currently missing — `package.json` says ISC but no file exists).

#### Deprioritized for v1

- **Dual CJS+ESM build** — ESM-only is sufficient. Same decision Pretext made.
- **CSS Grid (Phase 3)** — explicitly post-v1 per this document.
- **Pretext integration example** — useful demo but not a shipping blocker.
- **Multi-browser baselines** — Chromium-only is correct per the ground truth hierarchy.
- **CI/CD pipeline** — can be added after the initial publish.

### Phase 3 (Grid) — Complete (2026-07-05)

- [x] CSS Grid track sizing algorithm (explicit grid, fr, minmax, keywords, auto-repeat)
- [x] Grid item placement (explicit, spans, sparse and dense auto-placement, implicit tracks)
- [x] Mixed flex + grid trees (including grid intrinsic sizing)
- [x] New tiers 18-24 covering grid-specific test cases (13-17 were taken by gap, min/max-height, baseline, keyword sizing, and block-in-flex coverage)
- [x] Fitness metric extended to cover grid tiers (same runner; grid tiers are ordinary tiers)

Out of scope for v-grid-1 (documented in CLAUDE.md Known gaps and the README): percentage tracks, named lines/`grid-template-areas`, subgrid, masonry, grid baseline alignment, `order` in auto-placement, grid-line-based absolute positioning.

### Phase 4 (Text) — Complete (2026-07-05)

- [x] Width-dependent text via the `measureContent` contract, driven by captured word widths + greedy line breaking (fixtures are a pure function of Chromium-measured data, so a failing fixture indicts layout math, not text measurement).
- [x] Grid row contributions measured at the resolved column width (reordered `processNode` grid branch; constant-content items unaffected).
- [x] Flex text at the resolved main size in both directions, including the column min-height:auto floor (wrapped height at the used inline size) and the row min-width:auto floor (widest word) feeding line breaking.
- [x] New tiers 26 (text in flex) and 27 (text in grid).
- [x] Documented Pretext adapter (browser/worker only; `prepare()` needs a canvas) and README "Text" section.

Deferred (documented in CLAUDE.md Known gaps): width-dependent text one level deep — a text leaf inside a *nested* flex/grid container over-wraps because `computeIntrinsicContentSize` measures it at unconstrained intrinsic width, not the item's resolved width. Needs a degenerate-layout pass rather than a contribution reorder. Constant-size content nests correctly.

### Flagship consumer (Layout Assertions) — Shipped (2026-07-05)

The chosen flagship consumer (per the 2026-07-05 strategy review): layout assertions inside component/unit tests, the venue where a synchronous, zero-WASM, browser-free layout engine is uniquely necessary (jsdom computes no layout, WASM engines need async init in the runner, Playwright is a sledgehammer). OG-image generation was rejected as the flagship (Takumi owns that lane).

- [x] `examples/layout-assertions/` — self-contained example package (own `package.json`, vitest, imports the built `dist/`).
- [x] Assertion helpers over `LayoutResult` (`boxOf`, `overlaps`/`assertNoOverlaps`, `within`/`assertContained`, `overflowsX`/`overflowsY`) and the signature `sweep(widths, buildTree, invariant)` that solves at each width and reports the offending width.
- [x] Node-safe text measurement (`text-metrics.ts` greedy line breaker over committed per-word advances in `word-metrics.json`), mirroring the fixture runner's contract; Pretext supplies the same contract in a browser/worker runner.
- [x] `card-grid.test.ts` (header + `repeat(auto-fill, minmax(220px, 1fr))` grid + footer CTA, swept 320–1280) and `regression.test.ts` (a fixed sidebar width whose over-widening the sweep catches).
- [x] Root `npm run test:example` (builds `dist/`, installs the example, runs vitest); root README "Testing layouts" section.

Solver issue surfaced while building it (see CLAUDE.md Known gaps): a **nested** flex-wrap container's content-based (auto) cross size counts only the first flex line, so the container under-sizes when its items wrap. Item positions are correct; only the container's own auto cross size is wrong. Root-level wrap containers size correctly. The example avoids the path (its CTA row is budgeted to stay single-line in range and single-row is asserted from item positions, which are correct).

---

## Open Questions for Investigation

### Resolved

1. **Percentage resolution in indefinite contexts.** Resolved during Tier 7 implementation. Chromium's behavior is captured in the fixture corpus.

2. **Yoga test suite reusability.** Deprioritized. The Chromium-based fixture generator produces higher-fidelity ground truth than converted Yoga tests, which carry Yoga-specific deviations.

3. **Taffy as a starting point.** Resolved: build from scratch. The TypeScript solver meets all performance targets without Wasm, making Taffy wrapping unnecessary.

4. **Sub-pixel rounding strategy.** Resolved empirically. The 0.5px tolerance absorbs sub-pixel rounding differences. No Chromium-specific rounding replication was needed.

5. **Baseline alignment feasibility.** Resolved (Tier 15, 2026-07-05). Implemented directly against Chromium probe findings: empty boxes synthesize their baseline at the bottom border edge (row) or cross-start border edge (column); flex-container items derive their first baseline recursively from their first in-flow item. No `measureContent` baseline extension was needed — the solver's own resolved box models supply the offsets.

### Open

1. **Package naming.** Decide on the npm package name before first publish. Current `package.json` says `constraint-layout-algo` — evaluate whether a scoped name or shorter name is preferable.
