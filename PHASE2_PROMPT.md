# Session Prompt: Phase 2 — Real Text-Driven Layout + Pretext Adapter

Read `CLAUDE.md` first (ground truth hierarchy, iteration loop, known gaps). Everything stays local: no `git push`, no npm publish.

## Baseline

`npm run test` must show all tiers green (3040/3040 across tiers 1–25 as of 2026-07-05) and `npm run verify:explorer` 50/50. Tier 25 already locks *constant-size* content items (`measureContent` returning fixed dimensions) inside grid cells; tier 8 locks them in flex. This phase adds **width-dependent text**.

## Why this design (decided in the 2026-07-05 strategy review)

- The engine stays **zero-dependency**; Pretext is integrated as a documented adapter, not bundled. Hard constraint: Pretext's `prepare()` requires `OffscreenCanvas` or a DOM canvas and throws otherwise (`pretext/src/measurement.ts:47`) — it works in browsers and workers, **not bare Node**. Say so honestly wherever the adapter is documented.
- Fixtures must separate measurement error from layout error. The fixture's `measureContent` must be a **pure function of data captured from Chromium**, so a failing fixture always indicts the solver's layout math, never text measurement.

## Fixture methodology: captured word widths + greedy line breaking

1. **Generator**: for text items, render real text in the fixture HTML (a plain text node inside the item div, single font e.g. `16px Arial`, `line-height` fixed px, `overflow-wrap: normal`, no hyphenation). Build the string from a fixed word corpus with the seeded RNG.
2. **Capture**: in the same Puppeteer page, measure each word's advance width and the space width (canvas `measureText` in page context, same font), plus the used line height. Store in the fixture as `textMeasurements: { [id]: { wordWidths: number[], spaceWidth: number, lineHeight: number } }`.
3. **Runner**: `measureContent(availableWidth)` = greedy line breaker over the captured widths — pack words while `lineWidth + space + word ≤ availableWidth` (first word always fits); `height = lineCount * lineHeight`, `width = maxLineWidth`. `measureContent(0)` → widest word (min-content); `measureContent(Infinity)` → single line (max-content). This mirrors Pretext's `prepare()/layout()` contract exactly.
4. **Probe first**: before trusting the greedy model, probe Chromium for: fractional word-width rounding at line-break boundaries, trailing-space handling, and whether `getBoundingClientRect` heights quantize to line boxes. Encode any Chromium-specific epsilon as a named constant (Pretext pattern 4).

## Solver work (the hard part — measure at resolved width)

Width-dependent heights break the current ordering in the **grid** branch of `processNode` (`src/solver.ts`): row contributions are computed in the same loop as column contributions, before column widths resolve. Restructure to: column contributions → column track sizes/offsets → resolve each item's width (stretch/intrinsic) → **then** row contributions, calling `measureContent(resolvedWidth)` for text items → row track sizes/offsets → resolve heights. Constant-content items (tier 25) must be unaffected — their `measureContent` ignores the argument, so the reorder is invisible to locked fixtures; run the full suite after the reorder *before* generating new tiers.

Flex already measures at the resolved main size (Phase 5.5a2) for row direction; verify column direction and wrap interactions in the new tier rather than assuming.

## Suggested tiers (append-only; next unused is 26)

1. **Tier 26 — text in flex**: text items as flex children; row and column direction; grow/shrink around text; wrap where the text item's hypothetical size drives line breaking; min-width:auto floors from widest-word min-content.
2. **Tier 27 — text in grid**: text-driven track sizing — text items in `auto` / `fr` / `minmax()` tracks (min-content = widest word feeding fr minimums), spans over intrinsic tracks, stretch vs `justifyItems: start` (text width fit-content vs stretched), auto-height rows sized by wrapped text at the resolved column width.
3. **Tier 28 — mixed** (optional): text inside flex-in-grid / grid-in-flex if 26–27 surface no architectural issues; otherwise fold into 27.

## Pretext adapter (packaging, after the tiers pass)

- A small documented adapter (docs + demo code, not a package dependency): `prepare(text, font)` once, `measureContent = (w) => layout(prepared, w, lineHeight)`-shaped closure. The vendored `pretext/` tree is the dev reference; the README example should import `@chenglou/pretext` as the consumer would.
- Wire it into one demo for real (browser context — the explorer or a new card-grid demo) and verify against the browser reference pane.
- README: add a "Text" section — the engine takes `measureContent`; the adapter shows Pretext integration; note the Node/canvas limitation.

## Acceptance

- Reordered grid sizing lands with zero regressions in tiers 1–25 before any new fixtures are generated.
- New tiers 100%, all prior tiers green, `npm run bench` targets met, `verify:explorer` green.
- CLAUDE.md status + Known gaps, README, PROJECT.md updated; no claim without fixtures behind it.
- Single-line commits in the existing style, committed per fitness improvement.
