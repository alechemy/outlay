export type TrackSize =
  | number
  | "auto"
  | `${number}fr`
  | "min-content"
  | "max-content"
  | { min: number | "auto"; max: number | "auto" | `${number}fr` };

export type TrackDefinition =
  | number
  | "auto"
  | `${number}fr`
  | { min: number | "auto"; max: number | "auto" | `${number}fr` };

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

export interface LayoutNode {
  // Identity
  id: string;

  // Box model (all values in px, already resolved from CSS)
  width?: number | "auto" | "min-content" | "max-content";
  height?: number | "auto" | "min-content" | "max-content";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  padding: BoxSides; // { top, right, bottom, left } in px
  margin: MarginBoxSides; // supports "auto" for centering
  border: BoxSides; // widths only, in px
  boxSizing: "content-box" | "border-box";

  // Display and layout mode
  display: "flex" | "grid" | "block" | "none";

  // Flex container properties (when display === "flex")
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

  // Flex item properties
  flexGrow?: number; // default 0
  flexShrink?: number; // default 1
  flexBasis?: number | "auto" | "content";
  alignSelf?:
    | "auto"
    | "flex-start"
    | "flex-end"
    | "center"
    | "stretch"
    | "baseline";
  order?: number;

  // Grid container properties (Phase 3)
  gridTemplateColumns?: TrackDefinition[];
  gridTemplateRows?: TrackDefinition[];
  gridAutoRows?: TrackSize;
  gridAutoColumns?: TrackSize;
  gridAutoFlow?: "row" | "column" | "row dense" | "column dense";

  // Grid item properties (Phase 3)
  gridColumn?: {
    start: number | "auto";
    end: number | "auto" | `span ${number}`;
  };
  gridRow?: { start: number | "auto"; end: number | "auto" | `span ${number}` };

  // Positioning
  position?: "static" | "relative" | "absolute" | "fixed";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;

  // Children
  children: LayoutNode[];

  // Optional: intrinsic content size callback
  // For leaf nodes whose content size is externally determined
  // (e.g., text measured by Pretext)
  measureContent?: (availableWidth: number) => {
    width: number;
    height: number;
  };
}

export interface LayoutResult {
  boxes: Map<string, ResolvedBox>;
}

export interface ResolvedBox {
  id: string;

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

  // Final output
  boxes: Map<string, ResolvedBox>;
}

export interface SolverOptions {
  debug?: boolean;
}

export interface LayoutResultWithTrace extends LayoutResult {
  trace?: DebugTrace;
}
