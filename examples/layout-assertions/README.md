# Layout assertions in component tests

Assert how a component lays out — no overlaps, no overflow, the right number of
grid columns at each breakpoint — directly in a unit test, with no browser and no
async setup. `solveLayout` is synchronous and pure, so a test can solve the same
layout at a hundred viewport widths in a few milliseconds and check an invariant
at every one.

This is the venue where an off-DOM layout engine earns its keep:

- **jsdom computes no layout.** `getBoundingClientRect()` returns zeros, so layout
  assertions against jsdom are impossible.
- **WASM layout engines need async init** inside the test runner, and add a build
  wrinkle to every project that consumes them.
- **Playwright is a sledgehammer** for "does this row overflow at 375px" — seconds
  of browser startup per case, versus microseconds per solve here.

## Run it

From the repository root:

```sh
npm run test:example
```

That builds the library to `dist/`, installs this example's dev dependencies, and
runs the vitest suite.

To run it standalone (after `npm run build` in the repo root, which the tests import
from `../../dist`):

```sh
cd examples/layout-assertions
npm install
npm test
```

## What's here

- **`helpers.ts`** — assertion utilities over a `LayoutResult`: `boxOf`, `overlaps` /
  `assertNoOverlaps`, `within` / `assertContained`, `overflowsX` / `overflowsY`, and
  `sweep(widths, buildTree, invariant)` — the signature capability. `sweep` solves the
  tree at each width and collects the widths where the invariant failed, so a failure
  message tells you the exact viewport that broke.
- **`text-metrics.ts` + `word-metrics.json`** — a Node-safe `measureContent`. See below.
- **`card-grid.test.ts`** — a realistic header + responsive card grid
  (`repeat(auto-fill, minmax(220px, 1fr))`) + footer CTA row, asserted across
  `sweep(320..1280 step 20)`.
- **`regression.test.ts`** — the "what it catches" demo: a fixed sidebar width that,
  once widened past its threshold, squeezes the main content past the page edge. One
  test pins the shipped value green; another asserts the sweep *detects* the bad value.

## The sweep

```ts
const failures = sweep(range(320, 1280, 20), buildCardGrid, (result) => {
  assertNoOverlaps(result, cardIds);
  if (overflowsX(result, "page")) throw new Error("content crosses the page edge");
});
expect(failures).toEqual([]);
```

Each invariant throws on violation; `sweep` catches it and records `{ width, message }`,
so an assertion failure names the offending width instead of a generic "expected true".

## Scope: you are testing your layout model

These tests exercise the `LayoutNode` tree your component code produces and the boxes
the solver computes from it — not a rendered DOM. That is the point: it is fast and
deterministic, and it isolates *layout* regressions from styling and content noise. It
does **not** replace a visual or end-to-end test for painting, fonts, or CSS you did not
model.

## Text metrics are precomputed

`solveLayout` does no line breaking. A text node is a node with a `measureContent`
callback that returns the wrapped `{ width, height }` at a given available width.

`text-metrics.ts` is a greedy line breaker over per-word advance widths — the same
algorithm the library's fixture runner applies to Chromium-captured word widths.
`word-metrics.json` holds the per-word advances for the demo strings. In a browser or
worker test runner you would instead build `measureContent` from
[Pretext](https://github.com/chenglou/pretext), which measures text off a canvas; this
example precomputes advances so it runs in bare Node, where no canvas exists. Either way
the solver sees the same contract: give it the wrapped size at a width, and it drives
flex cross sizes and grid auto rows from it.
