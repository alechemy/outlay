# Changelog

## 1.3.0 — 2026-07-06

- `parseHTML` accepts percentage `width`/`height`/`flex-basis` (including the `flex` shorthand), matching the solver vocabulary; percentages remain rejected where unsupported (min/max, padding, tracks).
- New HTML Playground demo: paste HTML with inline styles, laid out off-DOM and compared live against the browser, with the strict parse-error UX on display.
- Layout Explorer gains controls for `aspectRatio`, percentage and `fit-content` sizes, keyword min/max, `fit-content()` tracks, and `alignContent` (including `space-evenly`) — 61 headlessly verified steps.

## 1.2.0 — 2026-07-06

- Percentage sizes: `"N%"` on `width`/`height`/`flexBasis` of flex children, resolved against the containing block's content box per box-sizing — including parents sized by the solver itself (flex-grown, stretched, and auto-main containers, where percentages re-resolve once the main size is determined, matching Chromium's cyclic behavior).
- Keyword min/max sizes: `minWidth`/`maxWidth`/`minHeight`/`maxHeight` accept `"min-content"` and `"max-content"`.
- `outlay/testing`: `sweep`, `assertNoOverlaps`, `overflowsX`/`overflowsY` — the README's layout-assertion helpers, now importable.
- `relativeTo` and `hitTest` result utilities on the root entry.
- Grid fixes: non-stretched grid items with content shrink-to-fit into their track instead of taking max-content; used inline sizes are clamped by the child's own min/max on every path.
- New `validateTree` warnings for coverage boundaries: `order` on grid children, fit-content tracks inside `repeat()`, fit-content cross sizes in wrap containers, aspect-ratio items in implicit tracks, and percentage sizes on grid children or the root.
- `GridDebugInfo` is exported; `main`/`types` fields and a `"./package.json"` export for legacy resolution.
- Now verified against Chromium across 4,450 fixtures (35 tiers).

## 1.1.0 — 2026-07-05

- `aspectRatio` on flex and grid items: transfer through the box-sizing box, transferred automatic minimums, and grid's normal-vs-explicit-stretch precedence, verified against Chromium (tier 32).
- `fit-content` as a `width`/`height` keyword and `{ fitContent: px }` grid tracks (tier 33).
- `alignContent: "space-evenly"` for flex and grid (tier 31).
- Node `id` is now optional — missing ids are auto-assigned, and `solveLayout` results are also keyed by input node reference via `result.nodes`.
- `result.contentSize` (union border-box extent), `ResolvedBox.parentId`, and `ResolvedBox.baseline`.
- `outlay/html`: `parseHTML`, a strict HTML-with-inline-styles → `LayoutNode` converter that throws `HTMLParseError` on anything outside the supported vocabulary.
- `outlay/text`: Node-safe LayoutUnit-quantized greedy line breaker (`measureFromAdvances`, `measureFromWordWidths`, `textNode`).
- `outlay/pretext`: browser/worker text measurement via Pretext (`text`, `measureText`); `@chenglou/pretext` is an optional peer dependency.
- Debug traces now include per-container grid track sizes, offsets, and placements.
- All public types are exported; the build ships source maps and declaration maps; `sideEffects: false` and an `engines` field.
- `validateTree`: warns on `flexBasis: "content"` with a definite main size (direction-aware).
- Now verified against Chromium across 4,150 fixtures (33 tiers).

## 1.0.0 — 2026-07-05

Initial release.

- Flexbox: direction, wrap, grow/shrink/basis, min/max clamping, `gap`, baseline alignment, auto margins, keyword sizing (`min-content`/`max-content`), `order`, block-in-flex subtrees.
- CSS Grid: explicit tracks (px, `fr`, `auto`, `minmax()`, keywords), `repeat()` including `auto-fill`/`auto-fit`, explicit placement and spans, sparse and dense auto-placement, implicit tracks, alignment and distribution, mixed flex+grid trees.
- Positioning: `relative`, `absolute`, `fixed` with inset resolution.
- Text via the `measureContent` contract: width-dependent content measured at resolved widths, `min-width: auto` floors from content, LayoutUnit-quantized line-fit parity with Chromium.
- `validateTree`: development-time input validation with errors for unsupported vocabulary and warnings for documented CSS divergences.
- Verified against Chromium at 0.5px tolerance across 3,700 generated fixtures (30 tiers).
