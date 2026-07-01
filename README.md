# constraint-layout-algo

Off-DOM CSS layout solver. Computes Flexbox positions and sizes without a browser. The layout equivalent of what [Pretext](https://github.com/chenglou/pretext) does for text measurement: extracting a DOM-dependent computation into standalone arithmetic.

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
  display?: "flex" | "block" | "none"; // "grid" reserved for future use
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

For leaf nodes whose content size is externally determined (e.g., text measured by Pretext). Called with the available width from the flex algorithm; returns the intrinsic `{ width, height }` of the content.

```ts
const textNode = {
  id: "label",
  measureContent: (availableWidth) => {
    const prepared = prepare(text, font);
    const { height } = layout(prepared, availableWidth, lineHeight);
    return { width: availableWidth, height };
  },
};
```

## What's supported

- Flexbox layout (row, column, reverse, wrap)
- `flex-grow`, `flex-shrink`, `flex-basis` with iterative clamping
- `justify-content`: all 6 values
- `align-items` / `align-self` / `align-content` (`baseline` is accepted by the types but not implemented)
- `gap` (single value and `{ row, column }`, including wrapped lines)
- `min-width` / `max-width` / `min-height` / `max-height` on both axes
- Multi-line wrapping (`wrap`, `wrap-reverse`)
- Nested flex containers with indefinite size resolution
- `min-content` / `max-content` intrinsic sizing
- `position: absolute` and `position: fixed`
- `margin: auto` centering (both axes)
- `display: none`
- `order` property
- `content-box` and `border-box` sizing

## Non-goals

- No CSS parsing, cascade, or selector matching -- caller provides resolved values
- No rendering or painting -- output is a position/size map
- No inline layout or line breaking (use Pretext for text)
- No floats, no table layout
- No CSS Grid (yet)

## Accuracy

1625 fixtures across 14 tiers, all passing at 100%. Ground truth is Chromium `getBoundingClientRect()` measurements. Tolerance: 0.5px per property per node.

## Performance

| Tree size    | Depth    | Time    |
| ------------ | -------- | ------- |
| 100 nodes    | 2 levels | ~0.06ms |
| 1,000 nodes  | 3 levels | ~1.1ms  |
| 10,000 nodes | 5 levels | ~14ms   |

Measured on Apple Silicon. Run `npm run bench` to reproduce.

## License

MIT
