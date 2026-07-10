# outlay

Off-DOM CSS layout solver. Computes Flexbox and CSS Grid positions and sizes without a browser, verified against Chromium's own layout engine at 0.5px tolerance across 4,450 generated fixtures. The layout equivalent of what [Pretext](https://github.com/chenglou/pretext) does for text measurement: extracting a DOM-dependent computation into standalone arithmetic.

## Installation

```sh
npm install outlay
```

ESM-only: the package ships as ES modules, with no CommonJS build.

## Quick example

```ts
import { solveLayout } from "outlay";

const root = {
  id: "root",
  width: 400,
  height: 200,
  children: [
    { id: "sidebar", width: 100 },
    { id: "main", flexGrow: 1 },
  ],
};

const { boxes } = solveLayout(root);
boxes.get("sidebar"); // { x: 0, y: 0, width: 100, height: 200, ... }
boxes.get("main"); // { x: 100, y: 0, width: 300, height: 200, ... }
```

Every field is optional. Nodes without an `id` get a collision-safe auto id, and
results are also keyed by the input node objects themselves:

```ts
const sidebar = { width: 100 };
const { nodes } = solveLayout({ width: 400, height: 200, children: [sidebar] });
nodes.get(sidebar); // same ResolvedBox, no ids involved
```

## HTML input

If a layout already exists in your head as markup, `outlay/html` converts an
HTML snippet with inline styles into a `LayoutNode` tree:

```ts
import { parseHTML } from "outlay/html";

const tree = parseHTML(`
  <div style="display: flex; width: 400px; height: 200px; gap: 8px">
    <div id="sidebar" style="width: 100px"></div>
    <div style="flex: 1"></div>
  </div>
`);
const { boxes } = solveLayout(tree);
```

The converter is strict by design: anything it accepts maps 1:1 onto the
supported vocabulary, and anything else (percentages, `em`, `calc()`, classes,
unknown properties, text content) throws an `HTMLParseError` naming the
offending declaration and element. Two deliberate mappings to know about:
elements without a `display` declaration become outlay's default (`flex`, not
CSS's `block`), and elements without `box-sizing` get an explicit
`"content-box"` (the browser default) so converted trees match what the
markup renders. It's a porting and experimentation tool — for programmatic
layout, build `LayoutNode` trees directly.

## Demos

Live at [alechemy.github.io/outlay](https://alechemy.github.io/outlay/): a layout explorer that renders the solver next to real browser CSS with a live match badge, plus animated transitions, drag-and-drop reorder, virtual scrolling, text-driven layout, and a nested dashboard with a solver-vs-native toggle. Locally: `npm start`, then open `/demos/index.html`.

## Defaults

| Property     | Default        |
| ------------ | -------------- |
| `display`    | `"flex"`       |
| `boxSizing`  | `"border-box"` |
| `padding`    | `0`            |
| `margin`     | `0`            |
| `border`     | `0`            |
| `children`   | `[]`           |
| `flexGrow`   | `0`            |
| `flexShrink` | `1`            |

`padding`, `margin`, and `border` accept a single number (uniform) or a partial `{ top?, right?, bottom?, left? }` object. Unspecified sides default to zero.

## API

### `solveLayout(root, options?) => { boxes, nodes, contentSize }`

- `root`: `LayoutNode` -- the tree to solve
- `options.debug`: `boolean` -- when true, returns a `trace` object with intermediate algorithm state (flex phases plus per-container grid track sizes, offsets, and placements)
- Returns:
  - `boxes: Map<string, ResolvedBox>` -- keyed by node id
  - `nodes: Map<LayoutNode, ResolvedBox>` -- the same boxes keyed by the input node references
  - `contentSize: { width, height }` -- the union extent of all border boxes (the scrollable size; e.g. total content height for a virtual scroller)

### `validateTree(root) => ValidationIssue[]`

The solver itself never validates: it assumes a well-formed tree and stays fast. `validateTree` is the development-time companion — run it in tests or behind a dev flag to catch the mistakes that would otherwise produce a silently wrong layout:

- **errors**: input outside the supported vocabulary — duplicate `id`s (result boxes are keyed by id), percentage or CSS-string sizes (`"50%"`, `"100px"`), unsupported enum values, malformed track lists or grid placements, `NaN` dimensions
- **warnings**: supported input that hits a documented divergence from browser CSS — a `display: "block"` container with no definite height (resolves to content-height 0), vertical margins in block flow (no margin collapse), `baseline` alignment in grid (treated as `start`), `flexBasis: "content"` with a definite main size (treated as `"auto"`, so the size wins), `order` on a grid child (ignored; grid places in document order), fit-content boundary cases (a `fit-content` track inside `repeat()`, or a `fit-content` cross size in a wrap container), an aspect-ratio item that may land in an implicit stretched auto track, plus typo detection for unknown property names (`"flex-direction"` → `flexDirection`)

Each issue carries `{ nodeId, path, severity, message }`, where `path` locates the node (e.g. `root.children[2]`).

```ts
import { solveLayout, validateTree } from "outlay";

if (process.env.NODE_ENV !== "production") {
  const issues = validateTree(tree);
  if (issues.length > 0) throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
}
const { boxes } = solveLayout(tree);
```

### `LayoutNode`

```ts
interface LayoutNode {
  id?: string; // auto-assigned when omitted

  // Box model
  width?: number | "auto" | "min-content" | "max-content" | "fit-content" | `${number}%`;
  height?: number | "auto" | "min-content" | "max-content" | "fit-content" | `${number}%`;
  minWidth?: number | "min-content" | "max-content";
  maxWidth?: number | "min-content" | "max-content";
  minHeight?: number | "min-content" | "max-content";
  maxHeight?: number | "min-content" | "max-content";
  aspectRatio?: number; // width / height, applied to the box-sizing box
  padding?: number | Partial<BoxSides>;
  margin?: number | Partial<MarginBoxSides>; // supports "auto" per-side
  border?: number | Partial<BoxSides>;
  boxSizing?: "content-box" | "border-box";

  // Flex container
  display?: "flex" | "grid" | "block" | "none";
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  justifyContent?:
    | "flex-start"
    | "flex-end"
    | "center"
    | "space-between"
    | "space-around"
    | "space-evenly";
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
  alignContent?:
    | "flex-start"
    | "flex-end"
    | "center"
    | "stretch"
    | "space-between"
    | "space-around"
    | "space-evenly";
  gap?: number | { row: number; column: number };

  // Flex item
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto" | "content" | `${number}%`;
  alignSelf?:
    | "auto"
    | "flex-start"
    | "flex-end"
    | "center"
    | "stretch"
    | "baseline";
  order?: number;

  // Positioning
  position?: "static" | "relative" | "absolute" | "fixed";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;

  // Content
  children?: LayoutNode[];
  measureContent?: (availableWidth: number) => {
    width: number;
    height: number;
  };
}
```

### `ResolvedBox`

```ts
interface ResolvedBox {
  id: string;
  parentId?: string; // input-tree parent (undefined for the root)
  x: number; // border-box position relative to root's content-box origin
  y: number;
  width: number; // content-box dimensions
  height: number;
  padding: BoxSides;
  border: BoxSides;
  margin: BoxSides; // includes resolved "auto" margins
  borderBoxWidth: number;
  borderBoxHeight: number;
  outerWidth: number; // borderBoxWidth + margin left + right
  outerHeight: number;
  baseline?: number; // border-box top to first baseline
}
```

### `measureContent` callback

For leaf nodes whose content size is externally determined (e.g. text). Called with the available content width; returns the intrinsic `{ width, height }` of the content at that width. The solver probes it at `0` (min-content) and `Infinity` (max-content) as well as at resolved widths, so **return the real content width, not the available width** — grid track sizing and `min-width: auto` floors depend on it.

See [Text](#text) for the Pretext adapter.

## Text

The engine does no line breaking itself. A text leaf is a node with a `measureContent` callback that reports the wrapped `{ width, height }` for a given available width. The solver measures each text item at its resolved width — the flex main size, or the grid column width after tracks resolve — so wrapped heights drive flex cross sizes and grid auto rows, and the widest word (`measureContent(0).width`) floors `min-width: auto` and intrinsic tracks.

Any measurer that honors that contract works, and two ship with the package:

**In a browser or worker**, `outlay/pretext` wraps [Pretext](https://github.com/chenglou/pretext) (an optional peer dependency — `npm install @chenglou/pretext`):

```ts
import { text } from "outlay/pretext";

const label = text("The quick brown fox", { font: "16px Arial", lineHeight: 20 });
// → a LayoutNode leaf; spread extra props: text("…", { font, lineHeight, flexGrow: 1 })
```

`text()` runs Pretext's one-time canvas measurement pass, so it needs an `OffscreenCanvas` or DOM canvas and throws in bare Node.

**In Node** (tests, servers), `outlay/text` provides the same greedy line breaker the fixture suite verifies against Chromium, driven by precomputed per-word advances:

```ts
import { measureFromWordWidths, textNode } from "outlay/text";

const measure = measureFromWordWidths("The quick brown fox", wordMetricsTable);
const label = textNode(measure, { id: "label" });
```

Capture the advances once (in a browser, or from font metrics) and commit them; `measureFromAdvances` takes a raw `number[]` if you manage words yourself.

Things to keep in mind:
- **Match the CSS wrapping mode.** Pretext models `overflow-wrap: break-word` (it breaks inside long words at narrow widths), so render the same text with `overflow-wrap: anywhere` for the browser to agree at widths narrower than a word. With `overflow-wrap: normal` the min-content is the widest word instead.
- **Quantize like the engine for exact agreement.** Chromium stores accumulated line widths and intrinsic text widths as LayoutUnit (1/64px, floored), so at knife-edge widths a word fits where raw float accumulation says it doesn't. Both shipped measurers apply this quantization; if you write your own, floor the running line width to 1/64 before each fit comparison and floor the widths you return. The solver itself stays quantization-free — the contract lives entirely in the `measureContent` implementation.

The `pages/demos/text-layout.html` demo wires this adapter into a live card grid and checks the solver against the browser at 0.5px tolerance.

## Testing layouts

Because `solveLayout` is synchronous and browser-free, you can assert a component's
layout — overlaps, overflow, breakpoint column counts — inside a plain unit test, and
sweep hundreds of viewport widths in a few milliseconds. The `outlay/testing` subpath
ships the primitives:

```ts
import { sweep, assertNoOverlaps, overflowsX } from "outlay/testing";

const widths = Array.from({ length: 49 }, (_, i) => 320 + i * 20); // 320…1280
const failures = sweep(widths, buildCardGrid, (result) => {
  assertNoOverlaps(result, cardIds);
  if (overflowsX(result, "page")) throw new Error("content crosses the page edge");
});
expect(failures).toEqual([]); // each failure names the width that broke
```

`sweep(widths, buildTree, invariant)` solves `buildTree(width)` at every width and
collects the widths where `invariant` throws. `assertNoOverlaps(result, ids?)` throws on
the first overlapping pair (siblings only when `ids` is omitted); `overflowsX` /
`overflowsY` report whether any descendant escapes a container's border box.

jsdom computes no layout, WASM engines need async init, and Playwright is a sledgehammer
for "does this overflow at 375px". A pure solver is the right tool. The full worked
example — those primitives plus a Node-safe text measurer, a responsive card grid, and a
regression guard — is in [`examples/layout-assertions/`](examples/layout-assertions/).
Run it with `npm run test:example`.

## What's supported

- Flexbox layout (row, column, reverse, wrap)
- `flex-grow`, `flex-shrink`, `flex-basis` with iterative clamping
- Percentage `width` / `height` / `flexBasis` on flex children, resolved against the containing block's content box — including parents sized by the solver itself (flex-grown, stretched, or auto-main containers, where percentages re-resolve once the main size is determined)
- `justify-content`: all 6 values
- `align-items` / `align-self` (including `baseline`) / `align-content` (all 7 values)
- `gap` (single value and `{ row, column }`, including wrapped lines)
- `min-width` / `max-width` / `min-height` / `max-height` on both axes, including `min-content` / `max-content` keywords (keyword heights assume width-independent content — see coverage boundaries)
- Multi-line wrapping (`wrap`, `wrap-reverse`)
- Nested flex containers with indefinite size resolution
- `min-content` / `max-content` / `fit-content` intrinsic sizing on container widths/heights and on flex items
- `aspectRatio` on flex and grid items (transferred sizes, transferred automatic minimums, stretch precedence)
- Width-dependent content via `measureContent` (e.g. text): items are measured at their resolved main size, so wrapped heights drive cross sizes, and the widest word floors `min-width: auto` and feeds line breaking (see [Text](#text))
- `display: block` containers with children, nested anywhere in a flex tree
- `position: absolute` and `position: fixed`
- `margin: auto` centering (both axes)
- `display: none`
- `order` property (flex)
- `content-box` and `border-box` sizing

There is no `overflow` property — outlay never paints or scrolls. The one layout-relevant effect of `overflow: hidden` in CSS, releasing a flex item's automatic minimum size so it can shrink past its content, is expressed with `minWidth: 0` / `minHeight: 0` on the shrinking child, exactly as in CSS flexbox practice.

CSS Grid (`display: "grid"`):

- Track sizing: fixed px, `fr` (content-based minimums), `auto`, `minmax()`, `min-content` / `max-content`, `fit-content(limit)` (as `{ fitContent: px }`), `repeat` (fixed-count, `auto-fill`, and `auto-fit` with empty-track collapse)
- Placement: explicit lines (positive and negative), `span n`, sparse auto-placement (`row` and `column` flow), `dense` packing
- Implicit tracks via `gridAutoRows` / `gridAutoColumns`
- `gap` (single value and `{ row, column }`)
- Alignment: `justifyItems` / `justifySelf`, `alignItems` / `alignSelf` (flex vocabulary; `flex-start`/`flex-end` behave as `start`/`end`), `justifyContent` / `alignContent` distribution, auto margins
- Grid and flex compose: grid inside flex, flex inside grid, nested grids, including intrinsic sizing of nested grids
- Text in grid cells: auto rows sized by wrapped text at the resolved column width; text `measureContent` feeds min-content (widest word) and max-content (single line) track contributions

Grid exclusions (v1): no percentage tracks (caller resolves them), no named lines or `grid-template-areas` (caller resolves to line numbers), no subgrid, no masonry, no grid baseline alignment.

Coverage boundaries (accepted, but outside the verified fixture set, so treat with care): aspect-ratio items in implicit stretched auto tracks; `fit-content` tracks inside `repeat()`; `fit-content` cross sizes in a wrap container; and aspect-ratio combined with auto margins. `validateTree` flags the ones it can detect statically.

## Non-goals

- No CSS parsing, cascade, or selector matching -- caller provides resolved values
- No rendering or painting -- output is a position/size map
- No inline layout or line breaking (use Pretext for text)
- No floats, no table layout
- No right-to-left direction or writing modes -- layout is left-to-right, `horizontal-tb`
- No block-flow margin collapsing, and no auto-height for `display: block` containers (give block containers a definite height)

## Accuracy

4450 fixtures across 35 tiers, all passing. Ground truth is Chromium `getBoundingClientRect()` measurements. Tolerance: 0.5px per property per node.

## Performance

| Tree size    | Depth    | Time    |
| ------------ | -------- | ------- |
| 100 nodes    | 2 levels | ~0.06ms |
| 1,000 nodes  | 3 levels | ~1.1ms  |
| 10,000 nodes | 5 levels | ~14ms   |

Measured on Apple Silicon. Run `npm run bench` to reproduce.

Every `solveLayout` call solves the whole tree from scratch; there is no incremental relayout or dirty-marking, so interactive callers at very large node counts should throttle solves or solve only the affected subtree.

## License

MIT
