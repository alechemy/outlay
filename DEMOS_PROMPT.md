# Demo Requirements

Build a set of browser demos for `constraint-layout-algo` that showcase practical and visually compelling uses of off-DOM layout solving. Each demo should be a standalone HTML page with a TypeScript entry point, served via a local dev server.

Use `pretext/pages/demos/` as the structural template: each demo is an HTML file + TS file under `pages/demos/`, with a landing page (`pages/demos/index.html`) linking to all of them. Match pretext's visual quality — the demos are the public face of the library.

## Guiding principles

1. **Dogfood `solveLayout` in every demo.** The layout solver must be the thing doing the spatial math. Don't just render divs with CSS flexbox — that defeats the point. The solver computes positions, then the demo renders them (canvas, absolutely-positioned divs, SVG, etc.).

2. **Show things CSS alone can't do easily.** The value proposition is "layout without a browser." Demos should make that tangible: layout that happens off the main thread, layout computed speculatively, layout animated without reflow, layout that runs server-side.

3. **Keep each demo focused.** One idea per demo. Self-contained. No shared framework beyond minimal utilities.

4. **Interactive where possible.** Resize, drag, toggle — let people poke at it. Static screenshots don't sell a layout engine.

## Demo ideas

### 1. Layout Explorer (practical, educational)

An interactive tree editor where users build a flex layout visually and see the solver's output in real time. Two panels: left panel is a tree of editable nodes (add/remove children, tweak properties via sliders/dropdowns), right panel is a live rendering of the solved layout as colored rectangles.

Key features:

- Add/remove nodes, nest containers
- Sliders for `width`, `height`, `flexGrow`, `flexShrink`, `gap`
- Dropdowns for `flexDirection`, `justifyContent`, `alignItems`, `flexWrap`
- Output panel shows solved boxes as nested colored divs with dimension labels
- Highlight a node to see its `ResolvedBox` values in a detail panel
- Export the tree as JSON

Why this works: it's the "hello world" demo that makes the API immediately understandable. Interactive exploration is something a static CSS playground can't do without triggering reflow for every change.

### 2. Drag-and-Drop Reorder (practical)

A sortable list/grid where items can be dragged to reorder. During the drag, the solver computes the layout of all items at 60fps to show where the dragged item would land — without touching DOM layout at all.

Key features:

- A grid of cards (3-4 columns, 10-15 items)
- Drag a card: all other cards animate to their new positions as computed by `solveLayout`
- The solver runs on every pointer-move to determine the insertion point and re-solve the layout
- Positions are applied via `transform: translate()` — zero reflow during the entire drag
- Drop commits the new order

Why this works: drag-and-drop layout prediction is a real-world use case (Notion, Linear, Figma). Running the solver per-frame during a drag is the kind of thing that's painful with DOM reflow but trivial with a pure-math solver.

### 3. Animated Layout Transitions (showy)

A set of flex containers that transition between different layout states. Click a button to change `flexDirection`, `justifyContent`, `flexWrap`, etc. — the solver computes both the before and after states, and items animate smoothly between them using interpolated positions.

Key features:

- A container of ~8-12 colored boxes
- Buttons to toggle: row ↔ column, nowrap ↔ wrap, different `justifyContent` values
- On each toggle, solve both layouts, then animate every box from old `(x, y, w, h)` to new `(x, y, w, h)` over ~400ms
- No CSS transitions or FLIP — the solver provides both endpoint positions directly
- Show the solver computation time in a corner badge to prove it's fast

Why this works: it's visually satisfying and demonstrates that having layout as pure arithmetic means you can interpolate between layout states trivially. CSS can't give you the "before" layout once you've changed the properties.

### 4. Virtual Scroll (practical)

A scrollable list of 10,000+ items with variable heights, where the solver computes the full layout upfront to enable perfect scroll virtualization — no height estimation, no "jump" corrections.

Key features:

- 10,000 items with varying content (and therefore varying heights via `measureContent`)
- The solver computes all positions in one pass (~14ms for 10k nodes per benchmarks)
- Only items in the viewport are rendered as DOM nodes
- Scrolling is smooth with no layout shifts or height corrections
- A counter shows total DOM nodes vs. total items
- Integrate with Pretext's `measureContent` for text height prediction if available, otherwise use a simple `measureContent` stub that varies height by content length

Why this works: virtual scrolling with variable row heights is a notoriously hard problem. Every production implementation (react-virtualized, tanstack-virtual) either guesses heights or measures them lazily with corrections. Computing them all upfront via `solveLayout` is the pitch.

### 5. Nested Dashboard (showy, practical)

A responsive dashboard layout with nested flex containers: header, sidebar, main content area with a grid of cards, each card containing its own flex layout. The entire layout is solved off-DOM and rendered via absolutely-positioned divs.

Key features:

- Resize the browser window — the solver re-runs and repositions everything without CSS flexbox
- A toggle to switch between "CSS layout" (native flex) and "solver layout" (computed positions) to show they match
- Deeply nested: outer shell → sidebar + main → card grid → individual card internals
- Show the solver timing for the full tree (~100-200 nodes)

Why this works: it's the "yes, this actually works for real UIs" demo. Showing side-by-side parity with native CSS flex is the strongest proof of correctness.

### 6. Server-Side Layout Preview (practical)

A Node.js script (not a browser demo — linked from the landing page as a code example) that reads a component tree from JSON, runs `solveLayout`, and outputs an SVG file showing the layout. Demonstrates the "no browser needed" value prop.

Key features:

- Reads a JSON layout tree from a file
- Calls `solveLayout`
- Writes an SVG with rectangles at the solved positions, labeled with node IDs
- Can be run via `node generate-layout.js input.json > output.svg`
- Landing page shows the generated SVG inline as a static image

Why this works: this is the demo for the SSR / testing / design-tool audience. No canvas, no DOM, no browser — just JSON in, positions out.

## Implementation notes

### Dev server

Add a `start` script to `package.json` that serves the `pages/` directory. Pretext uses `bun start` but since this project uses `tsx`/Node, a simple static file server (or vite) is fine. Keep it minimal.

### Rendering approach

Most demos should render the solved layout by setting `position: absolute` + `left`/`top`/`width`/`height` on div elements, using the `ResolvedBox` values directly. This is the most transparent rendering approach — users can inspect the DOM and see the solver's output mapped 1:1 to element positions.

Canvas rendering is fine for the drag-and-drop demo (performance) or the animation demo (smoothness), but div-based rendering should be the default since it's more inspectable.

### Styling

Match pretext's demo aesthetic: warm neutral palette, clean typography, minimal chrome. The landing page should follow the same card-grid pattern as `pretext/pages/demos/index.html`.

### File structure

```
pages/
  demos/
    index.html            — landing page with card grid
    explorer.html         — Layout Explorer
    explorer.ts
    drag-reorder.html     — Drag-and-Drop Reorder
    drag-reorder.ts
    transitions.html      — Animated Layout Transitions
    transitions.ts
    virtual-scroll.html   — Virtual Scroll
    virtual-scroll.ts
    dashboard.html        — Nested Dashboard
    dashboard.ts
    server-layout/        — Server-Side Layout Preview
      generate.ts
      example-input.json
      example-output.svg
```

## Priority order

Build in this order — each demo is independently shippable:

1. **Layout Explorer** — the essential "understand the API" demo
2. **Animated Transitions** — the most visually compelling, shareable
3. **Drag-and-Drop Reorder** — the strongest practical use case
4. **Virtual Scroll** — the strongest performance story (pairs with Pretext)
5. **Nested Dashboard** — the "real UI" correctness proof
6. **Server-Side Layout** — the SSR/tooling audience (lowest effort, just a script)

## What to avoid

- Don't build a CSS editor or parser. The solver takes resolved values, not CSS strings.
- Don't build demos that could be done just as easily with CSS flexbox. Every demo should have a reason it benefits from off-DOM solving (animation endpoints, speculative layout, zero-reflow interaction, server-side, etc.).
- Don't over-engineer shared infrastructure. Each demo is a standalone page. Shared utilities (color palette, render helpers) are fine, but no framework.
- Don't make the demos depend on Pretext. The `measureContent` integration is a bonus for the virtual scroll demo, not a requirement. Use a simple stub if Pretext isn't wired up yet.
