# Changelog

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
