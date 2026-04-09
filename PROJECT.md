# Project Scope: Off-DOM Constraint-Based CSS Layout Solver

## Summary

Build a JavaScript/WebAssembly library that answers the question "given these CSS constraints, what size and position will this element have?" without rendering anything in the browser. The library accepts a declarative description of a layout tree (container dimensions, display modes, child constraints) and outputs resolved box dimensions and positions using pure arithmetic.

This is the layout equivalent of what Pretext.js does for text measurement: extracting a historically DOM-dependent computation into a standalone, renderable-anywhere math layer.

The development methodology is designed for agent-driven iterative refinement. An agent should be able to take this document and autonomously work through a structured progression of increasingly difficult layout problems, using automated test generation and a continuous fitness metric to guide its own improvement loop over days or weeks of iteration.

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
  padding: BoxSides;       // { top, right, bottom, left } in px
  margin: BoxSides;        // supports "auto" for centering
  border: BoxSides;        // widths only, in px
  boxSizing: "content-box" | "border-box";

  // Display and layout mode
  display: "flex" | "grid" | "block" | "none";

  // Flex container properties (when display === "flex")
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between"
                 | "space-around" | "space-evenly";
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
  alignContent?: "flex-start" | "flex-end" | "center" | "stretch"
               | "space-between" | "space-around";
  gap?: number | { row: number; column: number };

  // Flex item properties
  flexGrow?: number;       // default 0
  flexShrink?: number;     // default 1
  flexBasis?: number | "auto" | "content";
  alignSelf?: "auto" | "flex-start" | "flex-end" | "center"
            | "stretch" | "baseline";
  order?: number;

  // Grid container properties (Phase 3)
  gridTemplateColumns?: TrackDefinition[];
  gridTemplateRows?: TrackDefinition[];
  gridAutoRows?: TrackSize;
  gridAutoColumns?: TrackSize;
  gridAutoFlow?: "row" | "column" | "row dense" | "column dense";

  // Grid item properties (Phase 3)
  gridColumn?: { start: number | "auto"; end: number | "auto" | `span ${number}` };
  gridRow?: { start: number | "auto"; end: number | "auto" | `span ${number}` };

  // Children
  children: LayoutNode[];

  // Optional: intrinsic content size callback
  // For leaf nodes whose content size is externally determined
  // (e.g., text measured by Pretext)
  measureContent?: (availableWidth: number) => { width: number; height: number };
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
  margin: BoxSides;  // includes resolved "auto" margins

  // Convenience computed values
  borderBoxWidth: number;
  borderBoxHeight: number;
  outerWidth: number;   // borderBoxWidth + margin.left + margin.right
  outerHeight: number;
}
```

### Accuracy Target

The solver must match Chromium's layout output within 0.5px for all supported properties across all passing test tiers. The tolerance is measured per-property per-node (not accumulated).

### Performance Targets

| Tree size | Nesting depth | Target | Context |
|-----------|---------------|--------|---------|
| 100 nodes | 2 levels | < 1ms | Animation frame budget |
| 1,000 nodes | 3 levels | < 5ms | Drag operation budget |
| 10,000 nodes | 5 levels | < 50ms | Design tool / SSR budget |

These are median times on a 2022-era laptop (Apple M1 or equivalent x86). Measure with `performance.now()`, not `Date.now()`.

---

## Architecture

### Modular Sub-Algorithm Design

The flexbox layout algorithm is specified by the W3C as a series of numbered steps (https://www.w3.org/TR/css-flexbox-1/#layout-algorithm). Each major step must be implemented as a separate, independently testable module. This is critical for agent-driven refinement: the agent must be able to identify which sub-algorithm is producing errors and refine it in isolation.

The required modules, mapped to spec sections:

| Module | Spec Section | Responsibility |
|--------|-------------|----------------|
| `resolveBoxModel` | n/a (pre-processing) | Apply `boxSizing` conversion, resolve padding/border/margin to content-box math |
| `determineFlexContainerSize` | 9.2 | Resolve the container's main and cross size from its constraints and context |
| `collectFlexItems` | 9.2 | Gather children, apply `order`, handle `display: none` |
| `determineMainSize` | 9.3 | Compute hypothetical main size of each flex item |
| `collectIntoLines` | 9.3 | Single-line or multi-line collection based on `flex-wrap` and available main size |
| `resolveFlexibleLengths` | 9.7 | The core flex algorithm: distribute free space or shrink overflow using grow/shrink factors with min/max clamping |
| `resolveCrossSize` | 9.4 | Determine cross size of each item and each flex line |
| `mainAxisAlignment` | 9.5 | Apply `justify-content` and auto margins on main axis |
| `crossAxisAlignment` | 9.6 | Apply `align-items`, `align-self`, `align-content` |
| `resolveAbsolutePositions` | Phase 2 | Handle `position: absolute/fixed` children |

Each module has:
- Its own unit test suite with targeted inputs and expected outputs.
- Its own micro-benchmark.
- A clear contract: input type, output type, and what properties it reads vs. modifies.

When the agent encounters a failing end-to-end test, it should trace the error to a specific module by logging intermediate results at module boundaries and comparing them to expected intermediate values.

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

CSS Grid track sizing (https://www.w3.org/TR/css-grid-1/#algo-track-sizing) is added as a separate set of modules that plug into the same tree-walking infrastructure. Grid and Flex must compose (a grid item can be a flex container and vice versa).

---

## Agent-Driven Refinement Protocol

This section defines the exact workflow for autonomous agent-driven development. The agent should follow this protocol without human intervention, escalating only when it hits a decision point listed in the Open Questions section.

### The Iteration Loop

Every iteration follows this cycle:

```
1. Run the full test suite for all unlocked tiers.
2. Compute the fitness score.
3. If the current tier is fully passing (100% pass rate), advance to the next tier.
4. If not, identify the highest-priority failing test:
   a. Prefer the simplest failing test (fewest nodes, fewest active properties).
   b. Among tests of equal complexity, prefer ones whose error magnitude is smallest
      (closest to passing, therefore most likely fixable with a small change).
5. Diagnose the failure:
   a. Log intermediate values at each module boundary.
   b. Compare intermediate values to a reference run (Chromium ground truth
      extracted by the test harness for the same input).
   c. Identify which module's output first diverges from the reference.
6. Modify the identified module.
7. Re-run the full suite (not just the target test) to detect regressions.
8. If the change improved the fitness score (even without flipping the target test
   from fail to pass), commit it.
9. If the change worsened the fitness score, revert it.
10. Return to step 1.
```

### Fitness Metric

The fitness score is a single number that the agent optimizes. It is computed as:

```
fitness = (number of passing tests / total tests in unlocked tiers)
        + (1 / (1 + mean_absolute_error_across_failing_tests))
```

The first term dominates (0 to 1 range, representing pass rate). The second term (0 to 1 range) provides gradient signal between discrete pass/fail flips. A change that reduces mean error across failing tests from 4.1px to 3.2px improves the fitness score even if no test flips from fail to pass.

The agent should log the fitness score after every iteration and maintain a running history. If the fitness score has not improved in 20 consecutive iterations, the agent should:
1. Re-examine its current approach and try a fundamentally different strategy.
2. If still stuck after 40 iterations, flag the specific failing test pattern for human review.

### Test Tiers (Difficulty Progression)

Tests are organized into numbered tiers. The agent begins at Tier 1 and advances only when the current tier has a 100% pass rate. Tests from all unlocked tiers are always run (regressions in earlier tiers block advancement).

**Tier 1: Static sizing (no flex behavior)**
- Fixed-width container, fixed-width children.
- Box model math only: padding, border, margin, `boxSizing`.
- Verifies that `resolveBoxModel` is correct in isolation.
- Approximately 50 generated test cases.

**Tier 2: Basic flex distribution (single axis, no wrapping)**
- `flex-grow` only, no shrink, no min/max constraints.
- Container has a definite main size. Children have `flex-basis: 0` or fixed basis.
- `flex-direction: row` only.
- Verifies `resolveFlexibleLengths` for the simple "distribute free space" case.
- Approximately 100 generated test cases.

**Tier 3: Flex shrink and min/max clamping**
- `flex-shrink` with overflow.
- `minWidth` / `maxWidth` interacting with grow/shrink.
- The clamping-and-refreeze loop in the flex algorithm (spec section 9.7, step 6).
- This is where most layout engines have subtle bugs. Expect slow progress here.
- Approximately 150 generated test cases.

**Tier 4: Cross-axis alignment**
- `align-items` and `align-self` variants.
- Cross-size resolution (`stretch`, definite cross size, auto cross size).
- `flex-direction: column` (swaps main/cross axes, tests that the solver is axis-agnostic).
- Approximately 100 generated test cases.

**Tier 5: justify-content and main-axis auto margins**
- All `justify-content` variants.
- `margin: auto` on main axis absorbing free space.
- Interaction between `justify-content` and auto margins (auto margins take priority).
- Approximately 75 generated test cases.

**Tier 6: Flex wrapping**
- `flex-wrap: wrap` and `wrap-reverse`.
- Multi-line containers.
- `align-content` for distributing space between lines.
- Approximately 150 generated test cases.

**Tier 7: Nested flex containers**
- Flex items that are themselves flex containers.
- Indefinite size resolution (a flex item's available space depends on its parent's flex algorithm, which depends on the item's intrinsic size, creating a circular dependency that the spec resolves with a specific procedure).
- Percentage dimensions in nested contexts.
- Approximately 200 generated test cases.

**Tier 8: Intrinsic content sizing**
- Leaf nodes with `measureContent` callbacks.
- `flex-basis: content` and `flex-basis: auto` with intrinsic sizes.
- `width: min-content` and `width: max-content` on flex items and containers.
- Integration point for Pretext.js-style text measurement.
- Approximately 100 generated test cases.

**Tier 9: Reverse and order**
- `flex-direction: row-reverse`, `column-reverse`.
- `order` property reordering items.
- Verifies that visual order and layout order are correctly separated.
- Approximately 50 generated test cases.

**Tier 10: Edge cases and adversarial inputs**
- Zero-size containers.
- Deeply nested trees (10+ levels).
- All flex items with `flex-grow: 0` and `flex-shrink: 0` (no flexibility).
- Negative margins.
- Extremely large values (testing numeric stability).
- `display: none` children interleaved with visible ones.
- Approximately 200 generated test cases.

Each tier includes both hand-written reference cases (for known tricky situations) and randomly generated cases (for coverage).

### Automated Test Generation

The test harness includes a generator that produces random layout trees constrained to the current tier's parameter space. This is essential: hand-written tests encode the author's assumptions about what's hard, but randomly generated tests surface unexpected interactions.

The generator works as follows:

```
For a given tier:
1. Define the parameter space (which CSS properties are active, value ranges).
2. Generate N random layout trees within that parameter space.
   - Tree depth: 1 to max_depth_for_tier.
   - Children per node: 1 to max_children_for_tier.
   - Property values: uniformly sampled from allowed ranges, with some
     bias toward edge values (0, very small, very large).
3. For each generated tree:
   a. Serialize it to the solver's JSON input format.
   b. Convert it to equivalent HTML/CSS.
   c. Render the HTML in headless Chromium.
   d. Extract getBoundingClientRect() for every element.
   e. Save the input JSON and Chromium's output as a test fixture.
4. The generated fixtures are deterministic (seeded RNG) and cached.
   Re-running the generator with the same seed produces the same tests.
```

The generator should be run once to produce the initial corpus, then re-run with new seeds periodically to expand coverage. The agent can also request new tests in a specific parameter subspace when it suspects a bug in a particular interaction (e.g., "generate 50 more tests where flex-shrink > 0 and minWidth is set").

### Intermediate Value Logging and Diagnosis

When a test fails, the agent needs to determine which sub-algorithm is wrong. To support this, the solver must expose a debug mode that logs the output of every module for a given input:

```typescript
interface DebugTrace {
  // After resolveBoxModel
  resolvedBoxModels: Map<string, {
    contentWidth: number;
    contentHeight: number;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    borderTop: number;
    borderRight: number;
    borderBottom: number;
    borderLeft: number;
    marginTop: number;
    marginRight: number;
    marginBottom: number;
    marginLeft: number;
  }>;

  // After collectFlexItems
  flexItemOrder: string[];  // item IDs in resolved order

  // After determineMainSize
  hypotheticalMainSizes: Map<string, number>;

  // After collectIntoLines
  flexLines: Array<{ itemIds: string[]; mainSize: number }>;

  // After resolveFlexibleLengths (per line)
  resolvedMainSizes: Map<string, number>;
  frozenItems: Map<string, "min-clamped" | "max-clamped" | "flexible">;

  // After resolveCrossSize
  resolvedCrossSizes: Map<string, number>;

  // Final output
  boxes: Map<string, ResolvedBox>;
}
```

The test harness should also extract intermediate reference values from Chromium where possible (e.g., computed flex-basis, used main size via `getComputedStyle`). Where Chromium doesn't expose intermediates, the harness can infer them from the final positions (e.g., if you know the container size and the final item positions, you can back-calculate how much free space was distributed).

The agent uses this to narrow failures: "the hypothetical main sizes are correct, but resolvedMainSizes after the flex length resolution step diverge from expected. The error is in `resolveFlexibleLengths`."

### Regression Prevention

Every time a test flips from failing to passing, it is marked as a **locked test**. If a locked test ever fails again, the iteration is treated as a regression and the change is automatically reverted, regardless of whether the overall fitness score improved. This prevents the common failure mode where fixing one case breaks a previously-solved case, leading to oscillation.

### Stall Detection and Recovery

If the fitness score plateaus (no improvement for 20 iterations), the agent should attempt these recovery strategies in order:

1. **Property isolation**: Take the simplest failing test and strip it down to the minimum properties that reproduce the failure. This often reveals that the issue is a specific two-property interaction, not a broad algorithmic problem.

2. **Reference comparison**: For the failing case, run a known-correct implementation (Yoga or Taffy via Wasm) and compare intermediate values. This can reveal whether the issue is a misunderstanding of the spec or a math error.

3. **Spec re-reading**: Re-read the specific section of the W3C spec that governs the failing step. The spec is the ground truth; Chromium's behavior is the target, but the spec explains why Chromium behaves that way. Sometimes the spec reveals a step or edge case that was missed entirely.

4. **Architectural pivot**: If the module's approach is fundamentally wrong (e.g., it's trying to resolve flex lengths in a single pass when the spec requires iterative clamping), restructure the module rather than patching it.

5. **Escalate**: After 40 iterations with no improvement, save the failing test cases, the current intermediate value traces, and a summary of attempted approaches. Flag for human review.

---

## Bootstrap Sequence

Before writing any layout algorithm code, the agent must build the infrastructure that makes iterative refinement possible. This is the required startup sequence:

### Step 1: Test Harness (iterations 1-5)
- Build the fixture runner: reads JSON fixtures, runs the solver, compares output, reports per-test pass/fail and per-property error magnitude.
- Build the Chromium-based generator: takes a tier definition (parameter space), generates random layout trees, renders them in headless Chromium via Puppeteer, captures `getBoundingClientRect()` for every element, writes fixture files.
- Generate the Tier 1 fixture corpus (50 tests).
- Verify the harness works by running it against a trivial stub solver that returns all zeros. Confirm it correctly reports failures with accurate error magnitudes.

### Step 2: Fitness Metric and Iteration Tracker (iterations 6-7)
- Implement the fitness score calculator.
- Build the iteration log: after each run, append an entry with timestamp, fitness score, number of passing/failing tests per tier, and a one-line summary of what changed.
- Build the regression lock: track which tests have previously passed, auto-revert changes that break locked tests.

### Step 3: Debug Trace Infrastructure (iterations 8-10)
- Add the `DebugTrace` interface to the solver's API.
- Wire up the trace logger so that every module boundary emits intermediate values.
- Build a trace comparator that takes two traces (solver vs. reference) and reports the first point of divergence.

### Step 4: Prior Art Evaluation (iterations 11-15)
- Convert 50 of Yoga's simplest test cases to fixture format. Run through Chromium to verify they produce the expected output. Report how many are directly usable.
- Compile Taffy to Wasm. Run Tier 1 and Tier 2 fixtures against it. Report accuracy, bundle size, and API friction. Write a short recommendation: wrap Taffy or build from scratch.
- Convert a sample of web-platform-tests flexbox tests to fixture format. Assess conversion difficulty and coverage overlap with the generated tests.

### Step 5: Begin Algorithm Implementation (iteration 16+)
- Only now start implementing the layout solver, beginning with Tier 1 (box model math).
- Follow the iteration loop defined in the Refinement Protocol.

---

## Testing Strategy

### Dual-Mode Test Suite

The test suite operates in two modes:

**Fixture mode** (default, fast): Runs the solver against pre-computed fixture files (JSON input + expected output). No browser required. This is what the agent runs on every iteration. Target: full suite completes in under 30 seconds.

**Generation mode** (slow, run periodically): Launches headless Chromium, generates new fixtures, and validates existing fixtures against current browser output. This catches cases where the fixtures themselves are wrong (e.g., due to a Chromium update changing layout behavior). Target: full regeneration completes in under 10 minutes.

### Fixture Format

Each fixture is a JSON file:

```json
{
  "tier": 3,
  "seed": 48291,
  "description": "flex-shrink with minWidth clamping, 3 items, row direction",
  "input": { "/* LayoutNode tree */" : true },
  "expected": {
    "node-1": { "x": 0, "y": 0, "width": 200, "height": 100 },
    "node-2": { "x": 200, "y": 0, "width": 150, "height": 100 }
  },
  "chromiumVersion": "128.0.6613.84",
  "tolerance": 0.5
}
```

### Targeted Test Generation on Demand

Beyond the initial corpus, the agent should be able to generate focused test batches when it suspects a specific property interaction is causing failures. The generator should accept parameter overrides:

```
generate-tests --tier 3 --count 50 --override "flexShrink=range(0.5,3.0)" --override "minWidth=range(0,200)" --seed 99001
```

This lets the agent explore a narrow region of the parameter space intensively when it's debugging a specific interaction.

### Benchmark Suite

A separate benchmark runs on every 10th iteration (not every iteration, to save time). It tracks:

- Median and p99 time for each tree size target (100, 1,000, 10,000 nodes).
- Memory allocation per run (using Node.js `process.memoryUsage()` delta).
- Time per module (using `performance.now()` around each sub-algorithm call).

The agent should not optimize for performance until Tier 7 is fully passing. Premature optimization of an incorrect algorithm wastes iterations.

---

## Prior Art

| Project | What to Learn | Watch Out For |
|---------|---------------|---------------|
| **Yoga** (Facebook) | Architecture, test suite, edge case handling for flexbox. Yoga has thousands of generated test cases that can serve as fixtures after format conversion. | Intentional spec deviations for cross-platform consistency. When Yoga and Chromium disagree, this project follows Chromium. |
| **Pretext.js** (Cheng Lou) | Development methodology (agent-driven refinement), API design philosophy, prepare/layout split. | Text-only; no layout solving. The methodology is what matters, not the code. |
| **Taffy** (Rust) | Modern Rust flexbox/grid implementation with good spec compliance. Evaluate as a potential Wasm starting point for Phase 2. | Rust-native API. Evaluate Wasm bundle size and whether its spec compliance is close enough to justify wrapping rather than reimplementing. |
| **web-platform-tests** (W3C) | Thousands of official CSS flexbox and grid test cases. | HTML-based; need automated conversion to the solver's input format. Many test CSS features outside this project's scope. |
| **Stretch** (Vislyhq, archived) | Earlier Rust flexbox engine. Yoga-compatible test suite. | Archived, known spec compliance gaps. |

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

These are unresolved decisions. The agent should investigate each one during the Bootstrap Sequence (Step 4) or when it first becomes relevant during tier progression. For each question, the agent writes a short decision document: problem statement, options considered, evidence gathered, recommendation. These investigations count as productive iterations even though they don't improve the fitness score.

1. **Percentage resolution in indefinite contexts.** When a flex item has `width: 50%` but the flex container has `width: auto`, browsers resolve this via a specific procedure. Generate 20 test cases exploring this interaction, document what Chromium does, and implement accordingly. This becomes relevant at Tier 7 (nested containers).

2. **Baseline alignment feasibility.** Flexbox baseline alignment (`align-items: baseline`) requires knowing the first baseline offset of each flex item's content. Investigate whether extending the `measureContent` callback to return a `baseline` offset is sufficient, or whether baseline alignment needs its own module. If the complexity is high relative to usage frequency, recommend deferring to a later phase. This becomes relevant at Tier 4 (cross-axis alignment).

3. **Yoga test suite reusability.** Yoga has thousands of generated test cases. Automate the conversion of Yoga's test format to this project's fixture format. Run the converted fixtures through Chromium to determine how many produce the same output as Yoga expects. Report: (a) how many are directly usable, (b) how many reflect Yoga-specific deviations, (c) whether the conversion is worth maintaining. Investigate during Bootstrap Step 4.

4. **Taffy as a starting point.** Compile Taffy to Wasm and benchmark it against the Tier 1-5 fixture corpus. Report: accuracy (% of fixtures passing at 0.5px tolerance), bundle size, API ergonomics. Recommend whether to use Taffy as the computation backend or build from scratch. Investigate during Bootstrap Step 4.

5. **Sub-pixel rounding strategy.** Browsers use specific rounding strategies when converting fractional layout values to pixel positions (e.g., Chromium rounds to 1/64th of a pixel internally). Investigate Chromium's rounding behavior and determine whether the solver needs to replicate it or whether the 0.5px tolerance absorbs the difference. This becomes relevant when Tier 2 tests show consistent small errors.
