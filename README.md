# constraint-layout-algo

Off-DOM CSS layout solver. Computes Flexbox and CSS Grid positions and sizes without a browser. The layout equivalent of what [Pretext](https://github.com/chenglou/pretext) does for text measurement: extracting a DOM-dependent computation into standalone arithmetic.

## Installation

```sh
npm install constraint-layout-algo
```

## Quick example

```ts
import { solveLayout } from "constraint-layout-algo";

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

Only `id` is required per node. Everything else has sensible defaults.

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

### `solveLayout(root, options?) => { boxes }`

- `root`: `LayoutNode` -- the tree to solve
- `options.debug`: `boolean` -- when true, returns a `trace` object with intermediate algorithm state
- Returns `{ boxes: Map<string, ResolvedBox> }`

### `LayoutNode`

```ts
interface LayoutNode {
  id: string;

  // Box model
  width?: number | "auto" | "min-content" | "max-content";
  height?: number | "auto" | "min-content" | "max-content";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
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
    | "space-around";
  gap?: number | { row: number; column: number };

  // Flex item
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto" | "content";
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
}
```

### `measureContent` callback

For leaf nodes whose content size is externally determined (e.g. text). Called with the available content width; returns the intrinsic `{ width, height }` of the content at that width. The solver probes it at `0` (min-content) and `Infinity` (max-content) as well as at resolved widths, so **return the real content width, not the available width** — grid track sizing and `min-width: auto` floors depend on it.

See [Text](#text) for the Pretext adapter.

## Text

The engine does no line breaking itself. A text leaf is a node with a `measureContent` callback that reports the wrapped `{ width, height }` for a given available width. The solver measures each text item at its resolved width — the flex main size, or the grid column width after tracks resolve — so wrapped heights drive flex cross sizes and grid auto rows, and the widest word (`measureContent(0).width`) floors `min-width: auto` and intrinsic tracks.

Any measurer that honors that contract works. [Pretext](https://github.com/chenglou/pretext) is a natural fit — the same "extract a DOM computation into arithmetic" idea, for text:

```ts
import { measureLineStats, prepareWithSegments } from "@chenglou/pretext";

function makeTextMeasure(text: string, font: string, lineHeight: number) {
  const prepared = prepareWithSegments(text, font); // one canvas pass, reusable
  return (availableWidth: number) => {
    const { lineCount, maxLineWidth } = measureLineStats(prepared, availableWidth);
    return { width: maxLineWidth, height: Math.max(1, lineCount) * lineHeight };
  };
}

const label = { id: "label", measureContent: makeTextMeasure(text, "16px Arial", 20) };
```

`measureLineStats` reports the widest line and the line count, which map directly onto the `{ width, height }` the solver expects at every probe width.

Two things to keep in mind:

- **Browser/worker only.** `prepareWithSegments` (like `prepare`) needs an `OffscreenCanvas` or a DOM canvas for its measurement pass and throws in bare Node. Run it where a canvas exists, or precompute per-word advances offline and feed them to a greedy line breaker (this is exactly what the fixture suite does — measurement is captured from Chromium once, so a failing fixture indicts layout math, not text measurement).
- **Match the CSS wrapping mode.** Pretext models `overflow-wrap: break-word` (it breaks inside long words at narrow widths), so render the same text with `overflow-wrap: anywhere` for the browser to agree at widths narrower than a word. With `overflow-wrap: normal` the min-content is the widest word instead.

The `pages/demos/text-layout.html` demo wires this adapter into a live card grid and checks the solver against the browser at 0.5px tolerance.

## Testing layouts

Because `solveLayout` is synchronous and browser-free, you can assert a component's
layout — overlaps, overflow, breakpoint column counts — inside a plain unit test, and
sweep hundreds of viewport widths in a few milliseconds:

```ts
const failures = sweep(range(320, 1280, 20), buildCardGrid, (result) => {
  assertNoOverlaps(result, cardIds);
  if (overflowsX(result, "page")) throw new Error("content crosses the page edge");
});
expect(failures).toEqual([]); // each failure names the width that broke
```

jsdom computes no layout, WASM engines need async init, and Playwright is a sledgehammer
for "does this overflow at 375px". A pure solver is the right tool. The full example —
assertion helpers, a Node-safe text measurer, a responsive card grid, and a regression
guard — is in [`examples/layout-assertions/`](examples/layout-assertions/). Run it with
`npm run test:example`.

## What's supported

- Flexbox layout (row, column, reverse, wrap)
- `flex-grow`, `flex-shrink`, `flex-basis` with iterative clamping
- `justify-content`: all 6 values
- `align-items` / `align-self` (including `baseline`) / `align-content`
- `gap` (single value and `{ row, column }`, including wrapped lines)
- `min-width` / `max-width` / `min-height` / `max-height` on both axes
- Multi-line wrapping (`wrap`, `wrap-reverse`)
- Nested flex containers with indefinite size resolution
- `min-content` / `max-content` intrinsic sizing on container widths/heights and on flex items
- Width-dependent content via `measureContent` (e.g. text): items are measured at their resolved main size, so wrapped heights drive cross sizes, and the widest word floors `min-width: auto` and feeds line breaking (see [Text](#text))
- `display: block` containers with children, nested anywhere in a flex tree
- `position: absolute` and `position: fixed`
- `margin: auto` centering (both axes)
- `display: none`
- `order` property (flex)
- `content-box` and `border-box` sizing

CSS Grid (`display: "grid"`):

- Track sizing: fixed px, `fr` (content-based minimums), `auto`, `minmax()`, `min-content` / `max-content`, `repeat` (fixed-count, `auto-fill`, and `auto-fit` with empty-track collapse)
- Placement: explicit lines (positive and negative), `span n`, sparse auto-placement (`row` and `column` flow), `dense` packing
- Implicit tracks via `gridAutoRows` / `gridAutoColumns`
- `gap` (single value and `{ row, column }`)
- Alignment: `justifyItems` / `justifySelf`, `alignItems` / `alignSelf` (flex vocabulary; `flex-start`/`flex-end` behave as `start`/`end`), `justifyContent` / `alignContent` distribution, auto margins
- Grid and flex compose: grid inside flex, flex inside grid, nested grids, including intrinsic sizing of nested grids
- Text in grid cells: auto rows sized by wrapped text at the resolved column width; text `measureContent` feeds min-content (widest word) and max-content (single line) track contributions

Grid exclusions (v1): no percentage tracks (caller resolves them), no named lines or `grid-template-areas` (caller resolves to line numbers), no subgrid, no masonry, no grid baseline alignment.

## Non-goals

- No CSS parsing, cascade, or selector matching -- caller provides resolved values
- No rendering or painting -- output is a position/size map
- No inline layout or line breaking (use Pretext for text)
- No floats, no table layout
- No block-flow margin collapsing, and no auto-height for `display: block` containers (give block containers a definite height)

## Accuracy

3460 fixtures across 28 tiers, all passing at 100%. Ground truth is Chromium `getBoundingClientRect()` measurements. Tolerance: 0.5px per property per node.

## Performance

| Tree size    | Depth    | Time    |
| ------------ | -------- | ------- |
| 100 nodes    | 2 levels | ~0.06ms |
| 1,000 nodes  | 3 levels | ~1.1ms  |
| 10,000 nodes | 5 levels | ~14ms   |

Measured on Apple Silicon. Run `npm run bench` to reproduce.

## License

MIT
