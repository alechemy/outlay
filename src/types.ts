export type TrackSize =
  | number
  | "auto"
  | `${number}fr`
  | "min-content"
  | "max-content"
  | { fitContent: number }
  | {
      min: number | "auto" | "min-content" | "max-content";
      max: number | "auto" | `${number}fr` | "min-content" | "max-content";
    };

export type TrackDefinition = TrackSize;

/** repeat() must resolve in the solver: auto-fill/auto-fit counts depend on the laid-out container size. */
export type TrackRepeat = {
  repeat: number | "auto-fill" | "auto-fit";
  tracks: TrackSize[];
};

export type TrackListEntry = TrackSize | TrackRepeat;

export interface BoxSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MarginBoxSides {
  top: number | "auto";
  right: number | "auto";
  bottom: number | "auto";
  left: number | "auto";
}

/** Shorthand: a number applies to all four sides, or specify per-side. */
export type BoxSidesInput = number | Partial<BoxSides>;

/** Shorthand: a number applies to all four sides, or specify per-side with optional "auto". */
export type MarginSidesInput = number | Partial<MarginBoxSides>;

/**
 * Public input type for layout nodes.
 *
 * Every field is optional. Defaults:
 * - `id`: auto-assigned (results are also keyed by node reference)
 * - `padding`, `margin`, `border`: zero on all sides
 * - `boxSizing`: `"border-box"`
 * - `display`: `"flex"`
 * - `children`: `[]`
 *
 * Padding, margin, and border accept a single number (all sides equal)
 * or a partial object (unspecified sides default to zero).
 */
export interface LayoutNode {
  /** Optional: nodes without an id get a collision-safe auto id. */
  id?: string;

  width?: number | "auto" | "min-content" | "max-content" | "fit-content";
  height?: number | "auto" | "min-content" | "max-content" | "fit-content";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** width / height. Applies to the box selected by `boxSizing`. */
  aspectRatio?: number;
  padding?: BoxSidesInput;
  margin?: MarginSidesInput;
  border?: BoxSidesInput;
  boxSizing?: "content-box" | "border-box";

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

  gridTemplateColumns?: TrackListEntry[];
  gridTemplateRows?: TrackListEntry[];
  gridAutoRows?: TrackSize;
  gridAutoColumns?: TrackSize;
  gridAutoFlow?: "row" | "column" | "row dense" | "column dense";
  justifyItems?: "start" | "end" | "center" | "stretch";

  gridColumn?: {
    start: number | "auto";
    end: number | "auto" | `span ${number}`;
  };
  gridRow?: { start: number | "auto"; end: number | "auto" | `span ${number}` };
  justifySelf?: "auto" | "start" | "end" | "center" | "stretch";

  position?: "static" | "relative" | "absolute" | "fixed";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;

  children?: LayoutNode[];

  measureContent?: (availableWidth: number) => {
    width: number;
    height: number;
  };
}

/** Internal normalized form with all defaults resolved. */
export interface NormalizedLayoutNode {
  id: string;

  width?: number | "auto" | "min-content" | "max-content" | "fit-content";
  height?: number | "auto" | "min-content" | "max-content" | "fit-content";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  aspectRatio?: number;
  padding: BoxSides;
  margin: MarginBoxSides;
  border: BoxSides;
  boxSizing: "content-box" | "border-box";

  display: "flex" | "grid" | "block" | "none";

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

  gridTemplateColumns?: TrackListEntry[];
  gridTemplateRows?: TrackListEntry[];
  gridAutoRows?: TrackSize;
  gridAutoColumns?: TrackSize;
  gridAutoFlow?: "row" | "column" | "row dense" | "column dense";
  justifyItems?: "start" | "end" | "center" | "stretch";

  gridColumn?: {
    start: number | "auto";
    end: number | "auto" | `span ${number}`;
  };
  gridRow?: { start: number | "auto"; end: number | "auto" | `span ${number}` };
  justifySelf?: "auto" | "start" | "end" | "center" | "stretch";

  position?: "static" | "relative" | "absolute" | "fixed";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;

  children: NormalizedLayoutNode[];

  measureContent?: (availableWidth: number) => {
    width: number;
    height: number;
  };
}

export interface LayoutResult {
  boxes: Map<string, ResolvedBox>;
  /** The same boxes keyed by the original input node references. */
  nodes: Map<LayoutNode, ResolvedBox>;
  /** Scrollable extent: the union of all border boxes (e.g. total content height for a virtual scroller). */
  contentSize: { width: number; height: number };
}

export interface ResolvedBox {
  id: string;

  /** Id of the input-tree parent; undefined for the root (absolute children still report their tree parent). */
  parentId?: string;

  // Position relative to the root container's content box origin
  x: number;
  y: number;

  // Final resolved dimensions (content box)
  width: number;
  height: number;

  // Resolved box model edges
  padding: BoxSides;
  border: BoxSides;
  margin: BoxSides; // includes resolved "auto" margins

  // Convenience computed values
  borderBoxWidth: number;
  borderBoxHeight: number;
  outerWidth: number; // borderBoxWidth + margin.left + margin.right
  outerHeight: number;

  /** Distance from the border-box top to the first baseline (bottom border edge for an empty box). */
  baseline?: number;
}

export interface ResolvedBoxModel {
  contentWidth: number;
  contentHeight: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
}

export interface FlexLineInfo {
  itemIds: string[];
  mainSize: number;
}

/** Per-container grid track sizing and item placement (mirrors the solver's internal grid layout). */
export interface GridDebugInfo {
  colSizes: number[];
  rowSizes: number[];
  colOffsets: number[];
  rowOffsets: number[];
  placements: Map<
    string,
    { colStart: number; colEnd: number; rowStart: number; rowEnd: number }
  >;
}

export interface DebugTrace {
  // After resolveBoxModel
  resolvedBoxModels: Map<string, ResolvedBoxModel>;

  // After collectFlexItems
  flexItemOrder: string[];

  // After determineMainSize
  hypotheticalMainSizes: Map<string, number>;

  // After collectIntoLines
  flexLines: FlexLineInfo[];

  // After resolveFlexibleLengths (per line)
  resolvedMainSizes: Map<string, number>;
  frozenItems: Map<string, "min-clamped" | "max-clamped" | "flexible">;

  // After resolveCrossSize
  resolvedCrossSizes: Map<string, number>;

  // Per grid container: track sizes, offsets, and item placements
  gridLayouts?: Map<string, GridDebugInfo>;

  // Final output
  boxes: Map<string, ResolvedBox>;
}

export interface SolverOptions {
  debug?: boolean;
}

export interface LayoutResultWithTrace extends LayoutResult {
  trace?: DebugTrace;
}
