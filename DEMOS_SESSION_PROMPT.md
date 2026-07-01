# Session Prompt: Build the Remaining Five Demos

Read `CLAUDE.md` first, then `DEMOS_PROMPT.md` — it is the full spec for all six demos and this prompt does not repeat it. This session builds demos 2–6 (Animated Transitions, Drag-and-Drop Reorder, Virtual Scroll, Nested Dashboard, Server-Side Layout Preview) in DEMOS_PROMPT.md's priority order. Each demo is independently shippable — commit after each one works, verified. Everything stays local: no `git push`, no npm publish.

## Baseline

Run `npm run test` (all tiers green, 1625/1625 as of 2026-07-01) and `npm run verify:explorer` (31/31). The solver now implements `gap` and min/max constraints on both axes — demos may use them freely.

## What already exists (state as of 2026-07-01)

- **Explorer is done** and sets the quality bar: `pages/demos/explorer.html` + `.ts`, with a browser-CSS reference pane rendered from the same state and a `#match-status` badge that diffs solver boxes against `getBoundingClientRect` at 0.5px tolerance.
- **Vite is configured**: `npm start`, root `pages/`, alias `constraint-layout-algo` → `src/index.ts`. Demos import the library by its package name.
- **`pages/demos/index.html`** is the landing page — add a card per demo as it ships.
- **`scripts/verify-explorer.ts`** is the verification pattern: spawn vite on a dedicated port, drive the page with puppeteer, assert, screenshot, exit nonzero on failure.

## Verification requirements (non-negotiable)

- Never claim a demo works without having driven it in a real browser and looked at a screenshot. Use the chrome-devtools MCP if available; otherwise write a puppeteer script per the `verify-explorer.ts` pattern.
- **tsx/esbuild pitfall**: any puppeteer script run via `tsx` must inject the `__name` shim before function-form `page.evaluate` calls (see `NAME_SHIM` in `scripts/verify-explorer.ts`), or evaluates fail with `__name is not defined`.
- For the **Nested Dashboard**'s CSS-vs-solver toggle, reuse the explorer's comparison technique (reference DOM + `getBoundingClientRect` diff) rather than inventing a new one — and remember any labels/content inside compared boxes must be `position: absolute` so they don't participate in the CSS layout being compared.
- Add a `verify:demos` script (or extend `verify-explorer.ts`) covering at least: transitions endpoints match two independent `solveLayout` calls; drag-reorder solve stays under a per-frame budget; virtual scroll renders only viewport items and total height matches the solved root; dashboard toggle reports parity.

## Demo-specific notes beyond DEMOS_PROMPT.md

- **Transitions**: both endpoint layouts come from `solveLayout` — no FLIP, no CSS transitions. Show solve time in the corner badge (`performance.now()` around the call, as the explorer does).
- **Drag reorder**: solver runs per pointer-move; apply positions via `transform: translate()`. The 1k-node benchmark is ~1.1ms — a 15-card grid is microseconds; display the number.
- **Virtual scroll**: use `measureContent` with a deterministic stub varying height by content; 10k nodes solve in ~14ms (see `npm run bench`). Don't depend on Pretext.
- **Dashboard**: deeply nested (~100–200 nodes); resize handling re-solves on `resize` events.
- **Server-side**: a Node script under `pages/demos/server-layout/` per the spec — run it during verification and commit the example SVG it produces so the landing page can show it statically.

## Acceptance criteria

- All five demos built, linked from the landing page, visually verified with screenshots.
- Scripted verification passes for the behaviors listed above.
- `npm run test` and `npm run verify:explorer` still green (demos must not touch `src/`; if a demo exposes a solver bug, that is a separate fix with a fixture first, per the iteration loop).
- CLAUDE.md "Demos" status line updated. Single-line commits, existing `feat:`/`chore:` style.
