# Development

## Setup

```sh
npm install
npx puppeteer browsers install chrome   # for the probe, generator, and browser verifiers
```

## Commands

| Command                      | What it does                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `npm test`                   | Run the full fixture suite (4,450 Chromium-captured fixtures across 35 tiers)     |
| `npm run test:validate`      | Unit tests for `validateTree`                                                     |
| `npm run test:trace`         | Unit tests for the debug-trace comparator                                         |
| `npm run test:example`       | Build `dist/` and run the `examples/layout-assertions` vitest package             |
| `npm run typecheck`          | Typecheck the whole project (src + tests)                                         |
| `npm run build`              | Emit `dist/` (ESM + declarations)                                                 |
| `npm run bench`              | Performance benchmark against the targets in the README                           |
| `npm run probe`              | Render HTML or a LayoutNode tree in headless Chromium and print computed boxes    |
| `npm run generate`           | Generate new fixture tiers from Chromium (see below)                              |
| `npm start`                  | Serve the demos (vite; landing page at `/demos/index.html`)                       |
| `npm run verify:explorer`    | Drive the explorer demo headlessly and fail on any solver-vs-browser mismatch     |
| `npm run verify:text-demo`   | Same for the text-layout demo                                                     |
| `npm run package-smoke-test` | Pack a tarball and verify a JS + TS consumer against it                           |

## How correctness works here

The fixtures are ground truth. Each one is a randomly generated layout tree rendered in real Chromium, with every element's `getBoundingClientRect()` captured as the expected output. The suite replays the tree through the solver and compares at 0.5px tolerance. `tests/locked_tests.json` pins every fixture that has ever passed; a regression stashes `src/` and fails the run.

Consequences for contributors:

- **Never edit a fixture's `expected` values.** If the solver disagrees with a fixture, the solver is wrong. If you believe Chromium itself changed, regenerate the tier and say so.
- **Probe before reasoning.** For any "what would Chromium do here" question, `npm run probe` with an HTML snippet on stdin is the arbiter — not the CSS spec. Chromium does not implement the spec 1:1, and this library matches Chromium.
- **New properties enter through the generator.** A property the generator can't emit is a property no fixture can falsify. Add it to `tests/generator.ts` first, generate a tier, and only then implement it in the solver.

To generate fixtures for a new tier:

```sh
npm run generate -- --tier 31 --count 120
```

## Repository layout

- `src/solver.ts` — flex/block/positioning core and the tree walk
- `src/grid.ts` — grid placement, track sizing, alignment math
- `src/validate.ts` — development-time input validation
- `tests/runner.ts` — fixture suite, fitness score, regression lock
- `tests/generator.ts` — Chromium-driven fixture generator
- `scripts/probe-chromium.ts` — the probe
- `pages/demos/` — browser demos (vite)
- `examples/layout-assertions/` — self-contained example package for layout assertions in component tests
- `pretext/` — optional local clone of [Pretext](https://github.com/chenglou/pretext); when present, the text demos resolve it from source (see `vite.config.ts`), otherwise the `@chenglou/pretext` npm package is used
