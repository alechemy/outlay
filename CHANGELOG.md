# Changelog

## 1.0.0 — Unreleased

Initial release.

- Flexbox: direction, wrap, grow/shrink/basis, min/max clamping, `gap`, baseline alignment, auto margins, keyword sizing (`min-content`/`max-content`), `order`, block-in-flex subtrees.
- CSS Grid: explicit tracks (px, `fr`, `auto`, `minmax()`, keywords), `repeat()` including `auto-fill`/`auto-fit`, explicit placement and spans, sparse and dense auto-placement, implicit tracks, alignment and distribution, mixed flex+grid trees.
- Positioning: `relative`, `absolute`, `fixed` with inset resolution.
- Text via the `measureContent` contract: width-dependent content measured at resolved widths, `min-width: auto` floors from content, LayoutUnit-quantized line-fit parity with Chromium.
- `validateTree`: development-time input validation with errors for unsupported vocabulary and warnings for documented CSS divergences.
- Verified against Chromium at 0.5px tolerance across 3,700 generated fixtures (30 tiers).
