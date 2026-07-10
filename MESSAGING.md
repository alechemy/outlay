# Messaging brief

The single story outlay leads with, until demand for another use case is
demonstrated (per `ADOPTION_PLAN.md`). Everything public — README, homepage,
package and repository descriptions, demo copy — should ladder up to this.

## One audience

Developers building **JavaScript rendering and layout infrastructure** that must
place elements without a browser: SVG and canvas scene graphs, PDF and report
generators, diagramming and whiteboard tools, design-tool and editor internals,
and headless component/layout testing.

They are not end users looking for a finished image. They already own their
paint, serialization, or assertion layer; the missing piece is *where the boxes
go*.

## One problem

To answer "what size and position will this element have?" outside a browser,
today's options are all bad for this audience:

- **Boot a DOM** (headless Chromium, jsdom). Chromium is heavy and async and
  unavailable in many runtimes; jsdom computes no layout at all — every box is
  0×0.
- **Adopt a WASM engine** (Yoga, Taffy). Async instantiation before first
  layout, and Yoga has no CSS Grid.
- **Hand-roll layout arithmetic.** Drifts from real CSS immediately and never
  catches up on Grid, intrinsic sizing, or wrapping.

None of them delivers synchronous, browser-faithful Flexbox **and** CSS Grid box
geometry in plain JavaScript.

## One differentiator

> **Inspectable, Chromium-matched Flexbox and CSS Grid layout boxes in pure
> synchronous JavaScript — no DOM, no WASM, no native binaries.**

The combination is what's unique: CSS Grid rules out Yoga; pure-sync-JS rules out
Taffy and Satori's Yoga-WASM; matched-to-Chromium rules out own-model engines;
returning boxes (not pixels) is the point for callers who own their own paint
layer. Accuracy is stated against the **supported CSS subset** — the vocabulary
the fixture suite exercises (see `COMPATIBILITY.md`), not full browser
compatibility.

## Positioning guardrails

- **Layout layer, not a renderer.** outlay stops at boxes; `outlay/svg` is a thin
  optional painter. It is *not* a stronger end-to-end image renderer than Takumi
  or Satori, which do raster output, image loading, and font shaping. Headless
  rendering is one downstream use of the boxes, presented as an example — not the
  headline.
- **Accuracy is scoped.** "Matches Chromium at 0.5px" always means "across the
  tested vocabulary," never "complete browser compatibility."
- **Don't oversell dependencies.** The core solver has no runtime dependencies;
  the `outlay/html` subpath pulls in `htmlparser2`, and `outlay/pretext` needs
  the optional `@chenglou/pretext` peer. Say "the core solver," not "zero
  dependencies."

## Proof points (use these, in order)

1. CSS Grid + Flexbox, matched to Chromium at 0.5px across 4,450 generated
   fixtures spanning the supported vocabulary.
2. Pure synchronous JavaScript — no DOM, no WASM, no native binaries, no async
   init.
3. Returns inspectable boxes (`x/y/width/height`, box-model edges, baselines),
   keyed by id or by the input node itself.
4. ~1ms for 1,000 nodes; ~14ms for 10,000. Synchronous, so it fits an animation
   frame or a request handler.
