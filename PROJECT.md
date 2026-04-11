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

### Phase 1 (Core Flex, Tiers 1-10)

- [ ] Test harness: fixture runner, Chromium-based generator, fitness metric
- [ ] Debug trace infrastructure with trace comparator
- [ ] Iteration log with regression lock
- [ ] Yoga/web-platform-tests fixture conversion pipeline
- [ ] Taffy evaluation report with recommendation
- [ ] TypeScript solver passing Tiers 1-7 at 100%
- [ ] TypeScript solver passing Tiers 8-10 at 100%
- [ ] Benchmark suite with per-module profiling
- [ ] npm-publishable package with zero runtime dependencies

### Phase 2 (Performance + Positioning)

- [ ] Performance optimization pass (must hit 5ms/1,000-node target)
- [ ] Wasm port of hot path if TypeScript optimization is insufficient
- [ ] `position: absolute` and `position: fixed` layout resolution (new tiers 11-12)
- [ ] Integration example with Pretext.js for text-aware layout
- [ ] `margin: auto` centering in both axes

### Phase 3 (Grid)

- [ ] CSS Grid track sizing algorithm (explicit grid)
- [ ] Grid item placement (explicit and auto-placement)
- [ ] Mixed flex + grid trees
- [ ] New tiers 13-18 covering grid-specific test cases
- [ ] Fitness metric extended to cover grid tiers

---

## Open Questions for Investigation

1. **Percentage resolution in indefinite contexts.** When a flex item has `width: 50%` but the flex container has `width: auto`, browsers resolve this via a specific procedure. Generate 20 test cases exploring this interaction, document what Chromium does, and implement accordingly. Relevant at Tier 7.

2. **Baseline alignment feasibility.** `align-items: baseline` requires knowing the first baseline offset of each flex item's content. Investigate whether extending `measureContent` to return a `baseline` offset is sufficient. If complexity is high relative to usage frequency, defer to a later phase. Relevant at Tier 4.

3. **Yoga test suite reusability.** Automate conversion of Yoga's test format to fixture format. Run converted fixtures through Chromium to determine how many are directly usable vs. reflect Yoga-specific deviations.

4. **Taffy as a starting point.** Compile Taffy to Wasm and benchmark against the Tier 1-5 fixture corpus. Report accuracy, bundle size, and API ergonomics. Recommend: wrap Taffy or build from scratch.

5. **Sub-pixel rounding strategy.** Chromium rounds to 1/64th of a pixel internally. Investigate whether the solver needs to replicate this or whether the 0.5px tolerance absorbs the difference. Relevant when Tier 2 tests show consistent small errors.
