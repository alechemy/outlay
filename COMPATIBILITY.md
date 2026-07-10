# Compatibility

outlay implements a subset of CSS layout. Accuracy claims apply to **that
subset — the tested vocabulary below — not to browser CSS as a whole.** Ground
truth is Chromium `getBoundingClientRect()`; where Chromium and the spec
disagree, outlay follows Chromium.

Four categories:

- **Verified** — has generated fixtures matched to Chromium at 0.5px per property
  per node (4,450 fixtures across 35 tiers).
- **Supported, unverified** — implemented and accepted, but outside the verified
  fixture set. Treat with care.
- **Divergences** — supported input that intentionally differs from browser CSS.
  `validateTree` warns on the ones it can detect statically.
- **Non-goals** — never implemented, by design.

## Verified

### Box model & positioning

| Behavior | Notes |
| --- | --- |
| `content-box` / `border-box` sizing | |
| `padding` / `border` / `margin` | uniform number or per-side object |
| `margin: auto` centering | both axes |
| `position: absolute` / `fixed` | inset-based sizing |
| `display: none` | |
| `display: block` containers with children | nested anywhere in a flex tree; must carry a definite height (see Divergences) |

### Flexbox

| Behavior | Notes |
| --- | --- |
| Direction | `row`, `column`, `row-reverse`, `column-reverse` |
| Wrapping | `wrap`, `wrap-reverse`, multi-line |
| `flexGrow` / `flexShrink` / `flexBasis` | iterative clamping (§9.7) |
| `justifyContent` | all 6 values |
| `alignItems` / `alignSelf` | including `baseline` |
| `alignContent` | all 7 values |
| `gap` | number or `{ row, column }`, including wrapped lines |
| `minWidth` / `maxWidth` / `minHeight` / `maxHeight` | both axes, incl. `min-content` / `max-content` keywords |
| `order` | |
| Nested flex with indefinite size resolution | |

### Intrinsic sizing

| Behavior | Notes |
| --- | --- |
| `min-content` / `max-content` / `fit-content` | container widths/heights and flex items |
| `aspectRatio` | flex and grid items — transferred sizes, transferred automatic minimums, stretch precedence |
| Percentage `width` / `height` / `flexBasis` | flex children, resolved against the containing block's content box, including solver-sized parents (flex-grown, stretched, auto-main) |

### CSS Grid (`display: "grid"`)

| Behavior | Notes |
| --- | --- |
| Track sizing | fixed px, `fr` (content-based minimums), `auto`, `minmax()`, `min-content` / `max-content`, `fit-content(limit)` (as `{ fitContent: px }`) |
| `repeat` | fixed-count, `auto-fill`, `auto-fit` with empty-track collapse |
| Placement | explicit lines (positive and negative), `span n`, sparse auto-placement (row/column flow), `dense` packing |
| Implicit tracks | `gridAutoRows` / `gridAutoColumns` |
| `gap` | number or `{ row, column }` |
| Alignment | `justifyItems` / `justifySelf`, `alignItems` / `alignSelf` (flex vocabulary; `flex-start`/`flex-end` behave as `start`/`end`), `justifyContent` / `alignContent` distribution, auto margins |
| Composition | grid ⊂ flex, flex ⊂ grid, nested grids, incl. intrinsic sizing of nested grids |

### Width-dependent content (text)

| Behavior | Notes |
| --- | --- |
| `measureContent` at resolved width | items measured at their resolved main / grid-column size; wrapped heights drive cross sizes and grid auto rows |
| `min-width: auto` floor | from the widest word (`measureContent(0)`) |
| Text in grid cells | auto rows sized by wrapped text at the resolved column width; min-content / max-content track contributions |

## Supported, unverified

Accepted and believed correct, but outside the verified fixture set:

- aspect-ratio items in implicit (`alignContent`-stretched) auto tracks
- `fit-content` tracks inside `repeat()`
- `fit-content` cross sizes in a wrap container
- `aspectRatio` combined with auto margins
- keyword `minHeight` / `maxHeight` on width-dependent (row-wrap) children — the
  static keyword pre-pass measures at the intrinsic width, so the generator only
  emits keyword heights on column-direction children

`validateTree` flags the cases it can detect statically.

## Divergences from browser CSS

Supported input that intentionally differs from Chromium. Where noted,
`validateTree` emits a **warning** (not an error).

| Behavior | outlay | Browser | Warned |
| --- | --- | --- | --- |
| `display: block` container, no definite height | content-height 0 | sizes to content | ✅ |
| Vertical margins in block flow | summed | adjacent siblings collapse | ✅ |
| `alignItems` / `alignSelf: baseline` in a grid | treated as `start` | true baseline alignment | ✅ |
| `flexBasis: "content"` with a definite main size | treated as `auto` (size wins) | `content` ignores the size | ✅ |
| `order` on a grid child | ignored (document order) | grid respects `order` | ✅ |
| `fit-content` track inside `repeat()`, or `fit-content` cross in a wrap container | best-effort | — | ✅ |
| aspect-ratio item that may land in an implicit stretched auto track | best-effort | — | ✅ |
| Unknown property names (`"flex-direction"`) | typo detection | ignored | ✅ |
| `outlay/font` advances | unshaped, unkerned (Chromium with `font-kerning: none`, ligatures off — to 0.015px) | default shaping is narrower on kerned pairs (`AV`, `To`), up to ~10px on kerning-heavy words | — |

## Non-goals

Never implemented, by design — the generator never emits them, so no fixture
asserts them:

- **No CSS parsing, cascade, or selector matching** — the caller provides
  resolved values.
- **No raster output** — the core produces boxes; `outlay/svg` is a thin optional
  painter, and PNG/PDF is the caller's rasterizer.
- **No rich inline layout** (bidi, shaping, mixed inline formatting) — word-level
  greedy breaking ships in `outlay/text` / `outlay/font`; use Pretext for
  browser-grade measurement.
- **No floats, no table layout.**
- **No right-to-left or vertical writing modes** — layout is left-to-right,
  `horizontal-tb`.
- **No block margin collapsing, and no auto-height for `display: block`
  containers** — give block containers a definite height.
- **No `overflow` property** — outlay never paints or scrolls. The one
  layout-relevant effect of `overflow: hidden` (releasing a flex item's automatic
  minimum so it can shrink past its content) is expressed with `minWidth: 0` /
  `minHeight: 0`.
- **No incremental relayout or dirty-marking** — every `solveLayout` call solves
  the whole tree.

### Grid non-goals (v1)

- Percentage tracks (caller resolves against a definite container)
- Named lines and `grid-template-areas` (caller resolves to line numbers)
- Subgrid and masonry
- Grid baseline alignment (`baseline` → `start`)
- `order` in grid auto-placement (document order)
- Grid-line-based inset resolution for absolute children
