import {
    BoxSides,
    BoxSidesInput,
    DebugTrace,
    FlexLineInfo,
    LayoutNode,
    LayoutResultWithTrace,
    MarginBoxSides,
    MarginSidesInput,
    NormalizedLayoutNode,
    ResolvedBox,
    ResolvedBoxModel,
    SolverOptions,
    TrackListEntry,
} from "./types.js";
import {
    GridLayoutInfo,
    TrackItemContribution,
    expandAutoRepeat,
    expandTrackList,
    gridItemAlign,
    gridItemJustify,
    resolvePlacements,
    resolveTrackSizes,
    trackOffsets,
} from "./grid.js";

const ZERO_SIDES: BoxSides = { top: 0, right: 0, bottom: 0, left: 0 };

function normalizeSides(input: BoxSidesInput | undefined): BoxSides {
  if (input === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof input === "number") return { top: input, right: input, bottom: input, left: input };
  return { top: input.top ?? 0, right: input.right ?? 0, bottom: input.bottom ?? 0, left: input.left ?? 0 };
}

function normalizeMargin(input: MarginSidesInput | undefined): MarginBoxSides {
  if (input === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof input === "number") return { top: input, right: input, bottom: input, left: input };
  return { top: input.top ?? 0, right: input.right ?? 0, bottom: input.bottom ?? 0, left: input.left ?? 0 };
}

function normalizeNode(node: LayoutNode): NormalizedLayoutNode {
  return {
    ...node,
    padding: normalizeSides(node.padding),
    margin: normalizeMargin(node.margin),
    border: normalizeSides(node.border),
    boxSizing: node.boxSizing ?? "border-box",
    display: node.display ?? "flex",
    children: (node.children ?? []).map(normalizeNode),
  };
}

function clampCrossContent(
  child: NormalizedLayoutNode,
  value: number,
  crossPaddingBorder: number,
  isRow: boolean,
): number {
  const crossMin = isRow ? child.minHeight : child.minWidth;
  const crossMax = isRow ? child.maxHeight : child.maxWidth;
  if (crossMin === undefined && crossMax === undefined) return value;
  let minCross = 0;
  let maxCross = Infinity;
  if (crossMin !== undefined) {
    minCross =
      child.boxSizing === "border-box"
        ? Math.max(0, crossMin - crossPaddingBorder)
        : crossMin;
  }
  if (crossMax !== undefined) {
    maxCross =
      child.boxSizing === "border-box"
        ? Math.max(0, crossMax - crossPaddingBorder)
        : crossMax;
  }
  if (maxCross < minCross) maxCross = minCross;
  return Math.max(minCross, Math.min(maxCross, value));
}

/**
 * Transfers a content-box size to the other axis through the node's aspect
 * ratio. The ratio applies to the box selected by box-sizing, so border-box
 * nodes transfer at the border-box level.
 */
function transferRatioContent(
  child: NormalizedLayoutNode,
  model: ResolvedBoxModel,
  from: "width" | "height",
  fromContent: number,
): number {
  const r = child.aspectRatio!;
  const hPB =
    model.paddingLeft + model.paddingRight + model.borderLeft + model.borderRight;
  const vPB =
    model.paddingTop + model.paddingBottom + model.borderTop + model.borderBottom;
  if (child.boxSizing === "border-box") {
    return from === "width"
      ? Math.max(0, (fromContent + hPB) / r - vPB)
      : Math.max(0, (fromContent + vPB) * r - hPB);
  }
  return from === "width" ? fromContent / r : fromContent * r;
}

function resolveGaps(
  node: NormalizedLayoutNode,
  isRow: boolean,
): { main: number; cross: number } {
  if (node.gap === undefined) return { main: 0, cross: 0 };
  const row = typeof node.gap === "number" ? node.gap : node.gap.row;
  const column = typeof node.gap === "number" ? node.gap : node.gap.column;
  return isRow ? { main: column, cross: row } : { main: row, cross: column };
}

function createTrace(): DebugTrace {
  return {
    resolvedBoxModels: new Map(),
    flexItemOrder: [],
    hypotheticalMainSizes: new Map(),
    flexLines: [],
    resolvedMainSizes: new Map(),
    frozenItems: new Map(),
    resolvedCrossSizes: new Map(),
    boxes: new Map(),
  };
}

function resolveBoxModel(node: NormalizedLayoutNode): ResolvedBoxModel {
  let contentWidth = typeof node.width === "number" ? node.width : 0;
  let contentHeight = typeof node.height === "number" ? node.height : 0;

  const p = node.padding;
  const b = node.border;
  const m = node.margin;
  const mTop = m.top === "auto" ? 0 : m.top;
  const mRight = m.right === "auto" ? 0 : m.right;
  const mBottom = m.bottom === "auto" ? 0 : m.bottom;
  const mLeft = m.left === "auto" ? 0 : m.left;

  if (node.boxSizing === "border-box" && typeof node.width === "number") {
    contentWidth = Math.max(
      0,
      node.width - p.left - p.right - b.left - b.right,
    );
  }
  if (node.boxSizing === "border-box" && typeof node.height === "number") {
    contentHeight = Math.max(
      0,
      node.height - p.top - p.bottom - b.top - b.bottom,
    );
  }

  return {
    contentWidth,
    contentHeight,
    paddingTop: p.top,
    paddingRight: p.right,
    paddingBottom: p.bottom,
    paddingLeft: p.left,
    borderTop: b.top,
    borderRight: b.right,
    borderBottom: b.bottom,
    borderLeft: b.left,
    marginTop: mTop,
    marginRight: mRight,
    marginBottom: mBottom,
    marginLeft: mLeft,
  };
}

function collectFlexItems(node: NormalizedLayoutNode): string[] {
  return node.children
    .filter((child) => {
      if (child.display === "none") return false;
      const pos = child.position ?? "static";
      if (pos === "absolute" || pos === "fixed") return false;
      return true;
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((child) => child.id);
}

function determineHypotheticalMainSize(
  child: NormalizedLayoutNode,
  boxModel: ResolvedBoxModel,
  isRow: boolean,
): number {
  let contentBaseSize = isRow ? boxModel.contentWidth : boxModel.contentHeight;
  if (typeof child.flexBasis === "number") {
    if (child.boxSizing === "border-box") {
      const paddingBorder = isRow
        ? boxModel.paddingLeft +
          boxModel.paddingRight +
          boxModel.borderLeft +
          boxModel.borderRight
        : boxModel.paddingTop +
          boxModel.paddingBottom +
          boxModel.borderTop +
          boxModel.borderBottom;
      contentBaseSize = Math.max(0, child.flexBasis - paddingBorder);
    } else {
      contentBaseSize = child.flexBasis;
    }
  }

  if (isRow) {
    return (
      contentBaseSize +
      boxModel.paddingLeft +
      boxModel.paddingRight +
      boxModel.borderLeft +
      boxModel.borderRight
    );
  }
  return (
    contentBaseSize +
    boxModel.paddingTop +
    boxModel.paddingBottom +
    boxModel.borderTop +
    boxModel.borderBottom
  );
}

function collectIntoLines(
  itemIds: string[],
  hypotheticalMainSizes: Map<string, number>,
  boxModelMap: Map<string, ResolvedBoxModel>,
  isRow: boolean,
  availableMainSize: number,
  wrap: boolean,
  mainGap: number,
): FlexLineInfo[] {
  if (!wrap || itemIds.length === 0) {
    let totalMainSize = 0;
    for (const id of itemIds) {
      const model = boxModelMap.get(id)!;
      const margin = isRow
        ? model.marginLeft + model.marginRight
        : model.marginTop + model.marginBottom;
      totalMainSize += (hypotheticalMainSizes.get(id) ?? 0) + margin;
    }
    totalMainSize += mainGap * Math.max(0, itemIds.length - 1);
    return [{ itemIds: [...itemIds], mainSize: totalMainSize }];
  }

  // Multi-line wrapping (spec 9.3)
  const lines: FlexLineInfo[] = [];
  let currentLineIds: string[] = [];
  let currentLineSize = 0;

  for (const id of itemIds) {
    const model = boxModelMap.get(id)!;
    const margin = isRow
      ? model.marginLeft + model.marginRight
      : model.marginTop + model.marginBottom;
    const outerHypo = (hypotheticalMainSizes.get(id) ?? 0) + margin;

    if (
      currentLineIds.length > 0 &&
      currentLineSize + mainGap + outerHypo > availableMainSize
    ) {
      lines.push({ itemIds: currentLineIds, mainSize: currentLineSize });
      currentLineIds = [id];
      currentLineSize = outerHypo;
    } else {
      currentLineSize += currentLineIds.length > 0 ? mainGap + outerHypo : outerHypo;
      currentLineIds.push(id);
    }
  }

  if (currentLineIds.length > 0) {
    lines.push({ itemIds: currentLineIds, mainSize: currentLineSize });
  }

  return lines;
}

/**
 * Resolves the inline size a column-container flex child will actually use —
 * stretched to the container, or fit-content when not stretching — so
 * block-axis intrinsic sizing can run against the real width (auto-repeat
 * column counts depend on it). Undefined when the container's width is
 * unknown.
 */
function usedInlineSize(
  container: NormalizedLayoutNode,
  containerModel: ResolvedBoxModel,
  containerWidthDefinite: boolean,
  child: NormalizedLayoutNode,
  childModel: ResolvedBoxModel,
  nodeMap: Map<string, NormalizedLayoutNode>,
  boxModelMap: Map<string, ResolvedBoxModel>,
): number | undefined {
  if (typeof child.width === "number") return childModel.contentWidth;
  if (!containerWidthDefinite) return undefined;
  const hPB =
    childModel.paddingLeft +
    childModel.paddingRight +
    childModel.borderLeft +
    childModel.borderRight;
  const avail = Math.max(
    0,
    containerModel.contentWidth -
      childModel.marginLeft -
      childModel.marginRight -
      hPB,
  );
  const align =
    (child.alignSelf && child.alignSelf !== "auto"
      ? child.alignSelf
      : container.alignItems) ?? "stretch";
  const stretches =
    align === "stretch" &&
    child.margin.left !== "auto" &&
    child.margin.right !== "auto";
  let value: number;
  if (stretches) {
    value = avail;
  } else {
    const maxC = computeIntrinsicContentSize(
      child,
      "width",
      nodeMap,
      boxModelMap,
      "max-content",
    );
    const minC = computeIntrinsicContentSize(
      child,
      "width",
      nodeMap,
      boxModelMap,
      "min-content",
    );
    value = Math.max(minC, Math.min(maxC, avail));
  }
  return clampCrossContent(child, value, hPB, false);
}

function gridIntrinsicSize(
  node: NormalizedLayoutNode,
  dimension: "width" | "height",
  nodeMap: Map<string, NormalizedLayoutNode>,
  boxModelMap: Map<string, ResolvedBoxModel>,
  mode: "min-content" | "max-content",
): number {
  const colTracks = expandTrackList(node.gridTemplateColumns);
  const rowTracks = expandTrackList(node.gridTemplateRows);
  const gridItems = node.children.filter((child) => {
    const pos = child.position ?? "static";
    return child.display !== "none" && pos !== "absolute" && pos !== "fixed";
  });
  const flow = node.gridAutoFlow?.startsWith("column") ? "column" : "row";
  const dense = node.gridAutoFlow?.includes("dense") ?? false;
  const { placements, colCount, rowCount } = resolvePlacements(
    gridItems,
    colTracks.length,
    rowTracks.length,
    flow,
    dense,
  );
  const isWidth = dimension === "width";
  const count = isWidth ? colCount : rowCount;
  const trackList = (isWidth ? colTracks : rowTracks).slice();
  while (trackList.length < count) {
    trackList.push(
      (isWidth ? node.gridAutoColumns : node.gridAutoRows) ?? "auto",
    );
  }
  const { main: colGap, cross: rowGap } = resolveGaps(node, true);
  const gap = isWidth ? colGap : rowGap;
  const items: TrackItemContribution[] = [];
  for (const child of gridItems) {
    const p = placements.get(child.id)!;
    const cm = boxModelMap.get(child.id)!;
    const pbm = isWidth
      ? cm.paddingLeft +
        cm.paddingRight +
        cm.borderLeft +
        cm.borderRight +
        cm.marginLeft +
        cm.marginRight
      : cm.paddingTop +
        cm.paddingBottom +
        cm.borderTop +
        cm.borderBottom +
        cm.marginTop +
        cm.marginBottom;
    const definite =
      typeof (isWidth ? child.width : child.height) === "number";
    const content = definite
      ? isWidth
        ? cm.contentWidth
        : cm.contentHeight
      : computeIntrinsicContentSize(child, dimension, nodeMap, boxModelMap, mode);
    items.push({
      start: isWidth ? p.colStart : p.rowStart,
      end: isWidth ? p.colEnd : p.rowEnd,
      min: content + pbm,
      max: content + pbm,
    });
  }
  // Block-axis intrinsic sizes have no min/max-content distinction, so fr
  // equalization always applies to heights; min-content widths skip it.
  const sizes = resolveTrackSizes(
    trackList,
    count,
    gap,
    undefined,
    items,
    true,
    mode === "max-content" || !isWidth,
  );
  let total = gap * Math.max(0, count - 1);
  for (const s of sizes) total += s;
  return total;
}

/**
 * Compute the intrinsic content-box size of a flex container in a given dimension.
 * mode: "min-content" uses flex-base-size; "max-content" uses max(flex-base, item max-content) for growable items.
 */
function hasAutoRepeat(entries?: TrackListEntry[]): boolean {
  return (
    entries?.some(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        "repeat" in e &&
        typeof e.repeat === "string",
    ) ?? false
  );
}

function subtreeHasWidthDependentContent(node: NormalizedLayoutNode): boolean {
  if (node.measureContent) {
    const min = node.measureContent(0);
    const max = node.measureContent(Infinity);
    if (min.height !== max.height || min.width !== max.width) return true;
  }
  if (
    node.display === "grid" &&
    (hasAutoRepeat(node.gridTemplateColumns) ||
      hasAutoRepeat(node.gridTemplateRows))
  ) {
    return true;
  }
  if (
    node.display === "flex" &&
    (node.flexWrap === "wrap" || node.flexWrap === "wrap-reverse") &&
    node.children.length > 0
  ) {
    return true;
  }
  for (const child of node.children) {
    if (subtreeHasWidthDependentContent(child)) return true;
  }
  return false;
}

/**
 * Block-axis intrinsic size at a known inline size, computed by actually
 * laying the subtree out at that width (Pretext pattern 1) — the only way
 * width-dependent descendants (wrapping text, auto-repeat tracks) resolve
 * the way real layout will. Constant-content subtrees keep the plain
 * intrinsic path, whose heights don't depend on the inline size.
 */
function containerHeightAtWidth(
  node: NormalizedLayoutNode,
  inlineContentSize: number,
): number {
  const widthValue =
    node.boxSizing === "border-box"
      ? inlineContentSize +
        node.padding.left +
        node.padding.right +
        node.border.left +
        node.border.right
      : inlineContentSize;
  const result = solveLayout({
    ...node,
    width: widthValue,
    height: undefined,
  } as LayoutNode);
  return result.boxes.get(node.id)!.height;
}

function computeIntrinsicContentSize(
  node: NormalizedLayoutNode,
  dimension: "width" | "height",
  nodeMap: Map<string, NormalizedLayoutNode>,
  boxModelMap: Map<string, ResolvedBoxModel>,
  mode: "min-content" | "max-content" = "min-content",
  inlineSize?: number,
): number {
  if (
    dimension === "height" &&
    inlineSize !== undefined &&
    (node.display === "flex" || node.display === "grid") &&
    node.children.length > 0 &&
    subtreeHasWidthDependentContent(node)
  ) {
    return containerHeightAtWidth(node, inlineSize);
  }
  if (node.display === "grid" && node.children.length > 0) {
    return gridIntrinsicSize(node, dimension, nodeMap, boxModelMap, mode);
  }
  if (node.display !== "flex" || node.children.length === 0) {
    if (node.measureContent) {
      const availW = mode === "min-content" ? 0 : Infinity;
      const measured = node.measureContent(availW);
      return dimension === "width" ? measured.width : measured.height;
    }
    return dimension === "width"
      ? boxModelMap.get(node.id)!.contentWidth
      : boxModelMap.get(node.id)!.contentHeight;
  }

  const isNodeRow =
    node.flexDirection === "row" ||
    node.flexDirection === "row-reverse" ||
    node.flexDirection === undefined;

  const isMainDimension = (dimension === "width") === isNodeRow;
  const itemIds = collectFlexItems(node);

  if (
    isMainDimension &&
    isNodeRow &&
    mode === "min-content" &&
    (node.flexWrap === "wrap" || node.flexWrap === "wrap-reverse")
  ) {
    // A wrapping main axis can break between every item, so its min-content
    // is the largest single item, not the single-line sum.
    let maxOuter = 0;
    for (const childId of itemIds) {
      const child = nodeMap.get(childId)!;
      const cm = boxModelMap.get(childId)!;
      const pb =
        cm.paddingLeft + cm.paddingRight + cm.borderLeft + cm.borderRight;
      const margins = cm.marginLeft + cm.marginRight;
      const contentW =
        typeof child.width === "number"
          ? cm.contentWidth
          : computeIntrinsicContentSize(
              child,
              "width",
              nodeMap,
              boxModelMap,
              "min-content",
            );
      maxOuter = Math.max(maxOuter, contentW + pb + margins);
    }
    return maxOuter;
  }

  if (isMainDimension) {
    let total = 0;
    for (const childId of itemIds) {
      const child = nodeMap.get(childId)!;
      const childModel = boxModelMap.get(childId)!;
      const pb = isNodeRow
        ? childModel.paddingLeft +
          childModel.paddingRight +
          childModel.borderLeft +
          childModel.borderRight
        : childModel.paddingTop +
          childModel.paddingBottom +
          childModel.borderTop +
          childModel.borderBottom;
      const margin = isNodeRow
        ? childModel.marginLeft + childModel.marginRight
        : childModel.marginTop + childModel.marginBottom;

      // Item's max-content main size (content-box)
      let maxContentMain: number;
      if (isNodeRow && typeof child.width === "number") {
        maxContentMain =
          child.boxSizing === "border-box"
            ? Math.max(0, (child.width as number) - pb)
            : (child.width as number);
      } else if (!isNodeRow && typeof child.height === "number") {
        maxContentMain =
          child.boxSizing === "border-box"
            ? Math.max(0, (child.height as number) - pb)
            : (child.height as number);
      } else if (child.display === "flex" || child.display === "grid") {
        maxContentMain = computeIntrinsicContentSize(
          child,
          dimension,
          nodeMap,
          boxModelMap,
          mode,
        );
      } else if (child.measureContent) {
        const availW = mode === "min-content" ? 0 : Infinity;
        const measured = child.measureContent(availW);
        maxContentMain = isNodeRow ? measured.width : measured.height;
      } else {
        maxContentMain = 0;
      }

      // Item's flex base size (content-box)
      let flexBase: number;
      if (typeof child.flexBasis === "number") {
        flexBase =
          child.boxSizing === "border-box"
            ? Math.max(0, child.flexBasis - pb)
            : child.flexBasis;
      } else {
        flexBase = maxContentMain;
      }

      // Contribution per CSS Flexbox spec 9.9.1:
      // Growable items: max(flex-base, max-content) when content > 0.
      // When content is 0 in height dimension (indefinite column container): items stay
      // at flex-base (no shrinkage in indefinite context), so use flex-base.
      // When content is 0 in width dimension: shrinkable items contribute 0 (min-content),
      // non-shrinkable items contribute flex-base.
      // For height, only apply when child has no explicit height; explicit height with
      // flexBasis means flexBasis wins in flex layout (avoid inflating with explicit height).
      const dimProp = isNodeRow ? "width" : "height";
      let contentSize: number;
      if (
        (child.flexGrow ?? 0) > 0 &&
        (dimension === "width" || typeof child[dimProp] !== "number")
      ) {
        if (maxContentMain > 0) {
          if (mode === "min-content" && (child.flexShrink ?? 1) > 0 && dimension === "width") {
            contentSize = maxContentMain;
          } else {
            contentSize = Math.max(flexBase, maxContentMain);
          }
        } else if (dimension === "height" || (child.flexShrink ?? 1) === 0) {
          // Height dimension: items stay at flex-base in indefinite container
          // Width dimension with no shrink: flex-base is hard minimum
          contentSize = flexBase;
        } else {
          // Width dimension, shrinkable, no content: contributes 0 (can shrink to nothing)
          contentSize = maxContentMain;
        }
      } else if (
        dimension === "width" &&
        (child.flexGrow ?? 0) === 0 &&
        (child.flexShrink ?? 1) > 0 &&
        typeof child[dimProp] !== "number" &&
        typeof child.flexBasis === "number" &&
        maxContentMain < flexBase
      ) {
        // Non-growable shrinkable item with no preferred main size:
        // contribute max-content, not flex-base (container doesn't need
        // to accommodate flex-basis for items that can shrink away)
        contentSize = maxContentMain;
      } else {
        // When item has an explicit main-axis dimension AND a flex-basis:
        // the effective minimum = max(flexBase, min(specifiedContent, recursiveMinContent))
        // This mirrors min-width:auto: clamp recursive min-content to specified size,
        // then take the larger of that and the flex-base.
        const hasExplicitMainDim = isNodeRow
          ? typeof child.width === "number"
          : typeof child.height === "number";
        if (hasExplicitMainDim && typeof child.flexBasis === "number" && child.display === "flex") {
          const specifiedContent = maxContentMain; // already computed from explicit dim
          const recursiveMinContent = computeIntrinsicContentSize(
            child, dimension, nodeMap, boxModelMap, "min-content"
          );
          contentSize = Math.max(flexBase, Math.min(specifiedContent, recursiveMinContent));
        } else if (!hasExplicitMainDim && (child.flexShrink ?? 1) === 0 && child.display === "flex") {
          // Non-shrinkable flex item with no explicit main size: min-width:auto
          // applies — the item can't shrink below its min-content size.
          const recursiveMinContent = computeIntrinsicContentSize(
            child, dimension, nodeMap, boxModelMap, "min-content"
          );
          contentSize = Math.max(flexBase, recursiveMinContent);
        } else {
          contentSize = flexBase;
        }
      }

      total += contentSize + pb + margin;
    }
    total += resolveGaps(node, isNodeRow).main * Math.max(0, itemIds.length - 1);
    return total;
  } else {
    const crossDim: "width" | "height" = isNodeRow ? "height" : "width";
    let maxOuter = 0;
    for (const childId of itemIds) {
      const child = nodeMap.get(childId)!;
      const childModel = boxModelMap.get(childId)!;
      const crossPB = isNodeRow
        ? childModel.paddingTop +
          childModel.paddingBottom +
          childModel.borderTop +
          childModel.borderBottom
        : childModel.paddingLeft +
          childModel.paddingRight +
          childModel.borderLeft +
          childModel.borderRight;
      const crossMargin = isNodeRow
        ? childModel.marginTop + childModel.marginBottom
        : childModel.marginLeft + childModel.marginRight;

      let contentCross: number;
      if (crossDim === "height" && typeof child.height === "number") {
        contentCross =
          child.boxSizing === "border-box"
            ? Math.max(0, (child.height as number) - crossPB)
            : (child.height as number);
      } else if (crossDim === "width" && typeof child.width === "number") {
        contentCross =
          child.boxSizing === "border-box"
            ? Math.max(0, (child.width as number) - crossPB)
            : (child.width as number);
      } else {
        contentCross = computeIntrinsicContentSize(
          child,
          crossDim,
          nodeMap,
          boxModelMap,
          mode,
        );
      }

      maxOuter = Math.max(maxOuter, contentCross + crossPB + crossMargin);
    }
    return maxOuter;
  }
}

export function solveLayout(
  root: LayoutNode,
  options?: SolverOptions,
): LayoutResultWithTrace {
  const normalizedRoot = normalizeNode(root);
  const debug = options?.debug ?? false;
  const trace = debug ? createTrace() : undefined;

  const result: LayoutResultWithTrace = {
    boxes: new Map<string, ResolvedBox>(),
  };

  const nodeMap = new Map<string, NormalizedLayoutNode>();
  const boxModelMap = new Map<string, ResolvedBoxModel>();

  interface LineLayout {
    itemIds: string[];
    crossSize: number;
    crossOffset: number;
    baselineAscent?: number;
    baselineDescent?: number;
  }
  const containerLineLayouts = new Map<string, LineLayout[]>();
  const containerGridLayouts = new Map<string, GridLayoutInfo>();
  const parentResolvedDims = new Map<string, Set<"width" | "height">>();

  interface ContainingBlockInfo {
    paddingBoxX: number;
    paddingBoxY: number;
    paddingBoxWidth: number;
    paddingBoxHeight: number;
  }
  let rootContainingBlock: ContainingBlockInfo;

  // Phase 1: Resolve box models for all nodes
  function resolveAllBoxModels(node: NormalizedLayoutNode) {
    nodeMap.set(node.id, node);
    const model = resolveBoxModel(node);
    boxModelMap.set(node.id, model);
    if (trace) {
      trace.resolvedBoxModels.set(node.id, model);
    }
    for (const child of node.children) {
      resolveAllBoxModels(child);
    }
  }
  resolveAllBoxModels(normalizedRoot);

  // Resolve `min-content`/`max-content` sizes to concrete intrinsic values so
  // downstream sizing treats them as definite (no stretch, correct flex base).
  // Post-order: a container's intrinsic size depends on its children's sizes.
  function resolveKeywordSizes(node: NormalizedLayoutNode) {
    for (const child of node.children) resolveKeywordSizes(child);
    const model = boxModelMap.get(node.id)!;
    const borderBox = node.boxSizing === "border-box";
    if (node.width === "min-content" || node.width === "max-content") {
      const intrinsic = computeIntrinsicContentSize(
        node,
        "width",
        nodeMap,
        boxModelMap,
        node.width,
      );
      model.contentWidth = intrinsic;
      const pb =
        model.paddingLeft +
        model.paddingRight +
        model.borderLeft +
        model.borderRight;
      node.width = borderBox ? intrinsic + pb : intrinsic;
    }
    if (node.height === "min-content" || node.height === "max-content") {
      const intrinsic = computeIntrinsicContentSize(
        node,
        "height",
        nodeMap,
        boxModelMap,
        node.height,
      );
      model.contentHeight = intrinsic;
      const pb =
        model.paddingTop +
        model.paddingBottom +
        model.borderTop +
        model.borderBottom;
      node.height = borderBox ? intrinsic + pb : intrinsic;
    }
  }
  resolveKeywordSizes(normalizedRoot);

  // Vertical distance from a node's border-box top to its first baseline.
  // For an empty box Chromium synthesizes the baseline at the bottom border
  // edge; a flex container inherits its first in-flow item's baseline.
  function computeBaselineOffset(node: NormalizedLayoutNode): number {
    const model = boxModelMap.get(node.id)!;
    const borderBoxHeight =
      model.contentHeight +
      model.paddingTop +
      model.paddingBottom +
      model.borderTop +
      model.borderBottom;
    if (node.display === "flex") {
      const items = collectFlexItems(node);
      if (items.length > 0) {
        const first = nodeMap.get(items[0])!;
        const firstModel = boxModelMap.get(first.id)!;
        return (
          model.borderTop +
          model.paddingTop +
          firstModel.marginTop +
          computeBaselineOffset(first)
        );
      }
    }
    return borderBoxHeight;
  }

  // Phase 2: Collect flex items (for flex containers)
  function processNode(node: NormalizedLayoutNode) {
    if (node.display === "flex") {
      const itemOrder = collectFlexItems(node);
      if (trace) {
        trace.flexItemOrder.push(...itemOrder);
      }

      const isRow =
        node.flexDirection === "row" ||
        node.flexDirection === "row-reverse" ||
        node.flexDirection === undefined;

      const { main: mainGap, cross: crossGap } = resolveGaps(node, isRow);
      const parentModel = boxModelMap.get(node.id)!;

      const crossDefiniteContainer = isRow
        ? typeof node.height === "number" ||
          (parentResolvedDims.get(node.id)?.has("height") ?? false)
        : typeof node.width === "number" ||
          (parentResolvedDims.get(node.id)?.has("width") ?? false);

      // Column flex: a width-dependent item's main size (block height) is its
      // wrapped height at the used inline size, and min-height:auto floors from
      // the same value (not from a zero-width measurement).
      const columnTextMetrics = (
        child: NormalizedLayoutNode,
        childModel: ResolvedBoxModel,
      ): { usedWidth: number; height: number } | null => {
        if (isRow || typeof child.width === "number") return null;
        if (!child.measureContent || !crossDefiniteContainer) return null;
        const maxCW = child.measureContent(Infinity).width;
        const minCW = child.measureContent(0).width;
        if (maxCW === minCW) return null;
        const m = childModel.marginLeft + childModel.marginRight;
        const pb =
          childModel.paddingLeft +
          childModel.paddingRight +
          childModel.borderLeft +
          childModel.borderRight;
        const availCross = Math.max(0, parentModel.contentWidth - m - pb);
        const align =
          child.alignSelf && child.alignSelf !== "auto"
            ? child.alignSelf
            : (node.alignItems ?? "stretch");
        const usedWidth =
          align === "stretch"
            ? availCross
            : Math.min(maxCW, Math.max(minCW, availCross));
        return { usedWidth, height: child.measureContent(usedWidth).height };
      };

      // Used cross-box content size a ratio item transfers its main size
      // from: an explicit cross size, or the stretched cross of a single-line
      // container with a definite cross size (stretch counts as definite
      // pre-layout, spec 9.8). Undefined when neither applies.
      const ratioCrossContent = (
        child: NormalizedLayoutNode,
        childModel: ResolvedBoxModel,
      ): number | undefined => {
        if (!child.aspectRatio) return undefined;
        const crossProp: "width" | "height" = isRow ? "height" : "width";
        const crossPB = isRow
          ? childModel.paddingTop +
            childModel.paddingBottom +
            childModel.borderTop +
            childModel.borderBottom
          : childModel.paddingLeft +
            childModel.paddingRight +
            childModel.borderLeft +
            childModel.borderRight;
        if (typeof child[crossProp] === "number") {
          return clampCrossContent(
            child,
            isRow ? childModel.contentHeight : childModel.contentWidth,
            crossPB,
            isRow,
          );
        }
        const isWrap =
          node.flexWrap === "wrap" || node.flexWrap === "wrap-reverse";
        const align =
          (child.alignSelf && child.alignSelf !== "auto"
            ? child.alignSelf
            : node.alignItems) ?? "stretch";
        const containerCrossDefinite = isRow
          ? typeof node.height === "number" ||
            (parentResolvedDims.get(node.id)?.has("height") ?? false)
          : typeof node.width === "number" ||
            (parentResolvedDims.get(node.id)?.has("width") ?? false);
        const crossMarginsAuto = isRow
          ? child.margin.top === "auto" || child.margin.bottom === "auto"
          : child.margin.left === "auto" || child.margin.right === "auto";
        if (
          isWrap ||
          align !== "stretch" ||
          !containerCrossDefinite ||
          crossMarginsAuto
        ) {
          // No definite or stretched cross: empty content, still subject to
          // the item's explicit cross min/max before the transfer.
          return clampCrossContent(child, 0, crossPB, isRow);
        }
        const crossMargin = isRow
          ? childModel.marginTop + childModel.marginBottom
          : childModel.marginLeft + childModel.marginRight;
        const containerCross = isRow
          ? parentModel.contentHeight
          : parentModel.contentWidth;
        return clampCrossContent(
          child,
          Math.max(0, containerCross - crossMargin - crossPB),
          crossPB,
          isRow,
        );
      };

      // Phase 3: Determine hypothetical main sizes
      const hypoMainSizes = new Map<string, number>();
      for (const childId of itemOrder) {
        const child = nodeMap.get(childId)!;
        const childModel = boxModelMap.get(childId)!;

        const mainDim: "width" | "height" = isRow ? "width" : "height";
        const pb = isRow
          ? childModel.paddingLeft +
            childModel.paddingRight +
            childModel.borderLeft +
            childModel.borderRight
          : childModel.paddingTop +
            childModel.paddingBottom +
            childModel.borderTop +
            childModel.borderBottom;
        let mainSize: number;
        const ratioApplies =
          child.aspectRatio !== undefined &&
          typeof child.flexBasis !== "number" &&
          typeof child[mainDim] !== "number";
        if (ratioApplies) {
          // With no definite or stretched cross size, the intrinsic main size
          // transfers from the cross axis's empty content (padding+border
          // only, for border-box) — probe-verified.
          mainSize =
            transferRatioContent(
              child,
              childModel,
              isRow ? "height" : "width",
              ratioCrossContent(child, childModel) ?? 0,
            ) + pb;
        } else if (
          child[mainDim] === "fit-content" &&
          typeof child.flexBasis !== "number"
        ) {
          const inline = !isRow
            ? usedInlineSize(
                node,
                boxModelMap.get(node.id)!,
                typeof node.width === "number" ||
                  (parentResolvedDims.get(node.id)?.has("width") ?? false),
                child,
                childModel,
                nodeMap,
                boxModelMap,
              )
            : undefined;
          const minC = computeIntrinsicContentSize(
            child,
            mainDim,
            nodeMap,
            boxModelMap,
            "min-content",
            inline,
          );
          const maxC = computeIntrinsicContentSize(
            child,
            mainDim,
            nodeMap,
            boxModelMap,
            "max-content",
            inline,
          );
          const mainDefinite = isRow
            ? typeof node.width === "number" ||
              (parentResolvedDims.get(node.id)?.has("width") ?? false)
            : typeof node.height === "number" ||
              (parentResolvedDims.get(node.id)?.has("height") ?? false);
          let fit = maxC;
          if (mainDefinite) {
            const mainMargin = isRow
              ? childModel.marginLeft + childModel.marginRight
              : childModel.marginTop + childModel.marginBottom;
            const availMain = Math.max(
              0,
              (isRow ? parentModel.contentWidth : parentModel.contentHeight) -
                mainMargin -
                pb,
            );
            fit = Math.max(minC, Math.min(maxC, availMain));
          }
          mainSize = fit + pb;
        } else if (
          (child.display === "flex" || child.display === "grid") &&
          typeof child.flexBasis !== "number" &&
          typeof child[mainDim] !== "number"
        ) {
          const intrinsicMain = computeIntrinsicContentSize(
            child,
            mainDim,
            nodeMap,
            boxModelMap,
            "min-content",
            !isRow && (child.display === "grid" || child.display === "flex")
              ? usedInlineSize(
                  node,
                  boxModelMap.get(node.id)!,
                  typeof node.width === "number" ||
                    (parentResolvedDims.get(node.id)?.has("width") ?? false),
                  child,
                  childModel,
                  nodeMap,
                  boxModelMap,
                )
              : undefined,
          );
          mainSize = intrinsicMain + pb;
        } else if (
          child.measureContent &&
          typeof child.flexBasis !== "number" &&
          typeof child[mainDim] !== "number"
        ) {
          // Content-based sizing: flex-basis auto/content with measureContent
          const ctm = columnTextMetrics(child, childModel);
          if (ctm) {
            mainSize = ctm.height + pb;
          } else {
            const measured = child.measureContent(Infinity);
            const contentMain = isRow ? measured.width : measured.height;
            mainSize = contentMain + pb;
          }
        } else {
          mainSize = determineHypotheticalMainSize(child, childModel, isRow);
        }

        // Hypothetical main size is the flex base clamped by main-axis
        // min/max (spec 9.2 step 3); mainSize here includes padding+border.
        const mainMin = isRow ? child.minWidth : child.minHeight;
        const mainMax = isRow ? child.maxWidth : child.maxHeight;
        if (mainMin !== undefined || mainMax !== undefined) {
          let minMain = 0;
          let maxMain = Infinity;
          if (mainMin !== undefined) {
            minMain = child.boxSizing === "border-box" ? mainMin : mainMin + pb;
          }
          if (mainMax !== undefined) {
            maxMain = child.boxSizing === "border-box" ? mainMax : mainMax + pb;
          }
          if (maxMain < minMain) maxMain = minMain;
          mainSize = Math.max(minMain, Math.min(maxMain, mainSize));
        }

        // Content-based automatic minimum (min-width/height:auto) floors the
        // hypothetical main size for width-dependent (text) items, so line
        // breaking and auto container sizing see the wrapped extent; capped by
        // a definite max main size.
        let autoFloor: number | undefined;
        if (isRow) {
          if (child.measureContent && typeof child.width !== "number") {
            const minCW = child.measureContent(0).width;
            if (minCW !== child.measureContent(Infinity).width) {
              autoFloor = minCW + pb;
            }
          }
        } else {
          const ctm = columnTextMetrics(child, childModel);
          if (ctm) autoFloor = ctm.height + pb;
        }
        if (autoFloor !== undefined) {
          const mMax = isRow ? child.maxWidth : child.maxHeight;
          if (mMax !== undefined) {
            const maxMain =
              child.boxSizing === "border-box" ? mMax : mMax + pb;
            autoFloor = Math.min(autoFloor, maxMain);
          }
          mainSize = Math.max(mainSize, autoFloor);
        }

        hypoMainSizes.set(childId, mainSize);
        if (trace) {
          trace.hypotheticalMainSizes.set(childId, mainSize);
        }
      }

      // Handle auto main-size containers
      const hasAutoMainSize = isRow
        ? typeof node.width !== "number"
        : typeof node.height !== "number";

      if (hasAutoMainSize) {
        const mainDimName: "width" | "height" = isRow ? "width" : "height";
        const resolved = parentResolvedDims.get(node.id);
        if (!resolved || !resolved.has(mainDimName)) {
          const dimValue = isRow ? node.width : node.height;
          if (dimValue === "min-content" || dimValue === "max-content") {
            const intrinsic = computeIntrinsicContentSize(
              node,
              mainDimName,
              nodeMap,
              boxModelMap,
              dimValue as "min-content" | "max-content",
            );
            if (isRow) {
              parentModel.contentWidth = intrinsic;
            } else {
              parentModel.contentHeight = intrinsic;
            }
          } else {
            let totalHypoOuter = 0;
            for (const childId of itemOrder) {
              const childModel = boxModelMap.get(childId)!;
              const margin = isRow
                ? childModel.marginLeft + childModel.marginRight
                : childModel.marginTop + childModel.marginBottom;
              totalHypoOuter += (hypoMainSizes.get(childId) ?? 0) + margin;
            }
            totalHypoOuter += mainGap * Math.max(0, itemOrder.length - 1);
            if (isRow) {
              parentModel.contentWidth = totalHypoOuter;
            } else {
              parentModel.contentHeight = totalHypoOuter;
            }
          }
        }
      }

      // Phase 4: Collect into lines
      const availableMainSize = isRow
        ? parentModel.contentWidth
        : parentModel.contentHeight;
      const wrap = node.flexWrap === "wrap" || node.flexWrap === "wrap-reverse";

      const lines = collectIntoLines(
        itemOrder,
        hypoMainSizes,
        boxModelMap,
        isRow,
        availableMainSize,
        wrap,
        mainGap,
      );
      if (trace) {
        trace.flexLines.push(...lines);
      }

      // Phase 5: Resolve flexible lengths (W3C CSS Flexbox spec 9.7)
      for (const line of lines) {
        interface FlexItemInfo {
          id: string;
          flexBaseSize: number;
          hypoMainSize: number;
          paddingBorder: number;
          marginMain: number;
          flexGrow: number;
          flexShrink: number;
          minContent: number;
          maxContent: number;
          frozen: boolean;
          targetMainSize: number;
        }

        const items: FlexItemInfo[] = [];
        for (const childId of line.itemIds) {
          const child = nodeMap.get(childId)!;
          const childModel = boxModelMap.get(childId)!;
          const marginMain = isRow
            ? childModel.marginLeft + childModel.marginRight
            : childModel.marginTop + childModel.marginBottom;
          const paddingBorder = isRow
            ? childModel.paddingLeft +
              childModel.paddingRight +
              childModel.borderLeft +
              childModel.borderRight
            : childModel.paddingTop +
              childModel.paddingBottom +
              childModel.borderTop +
              childModel.borderBottom;

          // Content-box flex base size (spec 9.2 step 3)
          let flexBaseSize: number;
          const mainDimProp: "width" | "height" = isRow ? "width" : "height";
          const ratioAppliesForBase =
            child.aspectRatio !== undefined &&
            typeof child.flexBasis !== "number" &&
            typeof child[mainDimProp] !== "number";
          if (typeof child.flexBasis === "number") {
            flexBaseSize =
              child.boxSizing === "border-box"
                ? Math.max(0, child.flexBasis - paddingBorder)
                : child.flexBasis;
          } else if (ratioAppliesForBase) {
            flexBaseSize = transferRatioContent(
              child,
              childModel,
              isRow ? "height" : "width",
              ratioCrossContent(child, childModel) ?? 0,
            );
          } else if (child[mainDimProp] === "fit-content") {
            const inline = !isRow
              ? usedInlineSize(
                  node,
                  boxModelMap.get(node.id)!,
                  typeof node.width === "number" ||
                    (parentResolvedDims.get(node.id)?.has("width") ?? false),
                  child,
                  childModel,
                  nodeMap,
                  boxModelMap,
                )
              : undefined;
            const minC = computeIntrinsicContentSize(
              child,
              mainDimProp,
              nodeMap,
              boxModelMap,
              "min-content",
              inline,
            );
            const maxC = computeIntrinsicContentSize(
              child,
              mainDimProp,
              nodeMap,
              boxModelMap,
              "max-content",
              inline,
            );
            const mainDefinite = isRow
              ? typeof node.width === "number" ||
                (parentResolvedDims.get(node.id)?.has("width") ?? false)
              : typeof node.height === "number" ||
                (parentResolvedDims.get(node.id)?.has("height") ?? false);
            flexBaseSize = maxC;
            if (mainDefinite) {
              const parentModelHere = boxModelMap.get(node.id)!;
              const availMain = Math.max(
                0,
                (isRow
                  ? parentModelHere.contentWidth
                  : parentModelHere.contentHeight) -
                  marginMain -
                  paddingBorder,
              );
              flexBaseSize = Math.max(minC, Math.min(maxC, availMain));
            }
          } else if (
            (child.display === "flex" || child.display === "grid") &&
            typeof child[mainDimProp] !== "number"
          ) {
            flexBaseSize = computeIntrinsicContentSize(
              child,
              mainDimProp,
              nodeMap,
              boxModelMap,
              mainDimProp === "width" ? "max-content" : "min-content",
              !isRow && (child.display === "grid" || child.display === "flex")
                ? usedInlineSize(
                    node,
                    boxModelMap.get(node.id)!,
                    typeof node.width === "number" ||
                      (parentResolvedDims.get(node.id)?.has("width") ?? false),
                    child,
                    childModel,
                    nodeMap,
                    boxModelMap,
                  )
                : undefined,
            );
          } else if (
            child.measureContent &&
            typeof child[mainDimProp] !== "number"
          ) {
            const ctm = columnTextMetrics(child, childModel);
            if (ctm) {
              flexBaseSize = ctm.height;
            } else {
              const measured = child.measureContent(Infinity);
              flexBaseSize = isRow ? measured.width : measured.height;
            }
          } else {
            flexBaseSize = isRow
              ? childModel.contentWidth
              : childModel.contentHeight;
          }

          // Min/max in content-box terms
          let minContent = 0;
          let maxContent = Infinity;
          let autoMinFromContent = false;
          if (isRow) {
            if (child.minWidth !== undefined) {
              minContent =
                child.boxSizing === "border-box"
                  ? Math.max(0, child.minWidth - paddingBorder)
                  : child.minWidth;
            } else if (child.display === "flex" || child.display === "grid") {
              // An empty flex item has no content, so its min-content is 0
              // (min-width:auto lets it shrink to nothing).
              let contentMin =
                collectFlexItems(child).length === 0
                  ? 0
                  : computeIntrinsicContentSize(
                      child,
                      "width",
                      nodeMap,
                      boxModelMap,
                      "min-content",
                    );
              if (typeof child.width === "number") {
                const specifiedContent =
                  child.boxSizing === "border-box"
                    ? Math.max(0, (child.width as number) - paddingBorder)
                    : (child.width as number);
                minContent = Math.min(specifiedContent, contentMin);
              } else {
                minContent = contentMin;
              }
            } else if (child.measureContent) {
              const measured = child.measureContent(0);
              minContent = measured.width;
              autoMinFromContent = true;
            }
            if (child.maxWidth !== undefined) {
              maxContent =
                child.boxSizing === "border-box"
                  ? Math.max(0, child.maxWidth - paddingBorder)
                  : child.maxWidth;
            }
          } else {
            if (child.minHeight !== undefined) {
              minContent =
                child.boxSizing === "border-box"
                  ? Math.max(0, child.minHeight - paddingBorder)
                  : child.minHeight;
            } else if (child.display === "flex" || child.display === "grid") {
              let contentMin =
                collectFlexItems(child).length === 0
                  ? 0
                  : computeIntrinsicContentSize(
                      child,
                      "height",
                      nodeMap,
                      boxModelMap,
                      "min-content",
                      !isRow && (child.display === "grid" || child.display === "flex")
                        ? usedInlineSize(
                            node,
                            boxModelMap.get(node.id)!,
                            typeof node.width === "number" ||
                              (parentResolvedDims.get(node.id)?.has("width") ??
                                false),
                            child,
                            childModel,
                            nodeMap,
                            boxModelMap,
                          )
                        : undefined,
                    );
              if (typeof child.height === "number") {
                const specifiedContent =
                  child.boxSizing === "border-box"
                    ? Math.max(0, (child.height as number) - paddingBorder)
                    : (child.height as number);
                minContent = Math.min(specifiedContent, contentMin);
              } else {
                minContent = contentMin;
              }
            } else if (child.measureContent) {
              const ctm = columnTextMetrics(child, childModel);
              minContent = ctm ? ctm.height : child.measureContent(0).height;
              autoMinFromContent = true;
            }
            if (child.maxHeight !== undefined) {
              maxContent =
                child.boxSizing === "border-box"
                  ? Math.max(0, child.maxHeight - paddingBorder)
                  : child.maxHeight;
            }
          }
          // A ratio item's automatic minimum floors at the transferred size
          // (probe-verified: it refuses to shrink below the ratio-derived
          // main size); a specified main size caps that floor.
          const explicitMin = isRow ? child.minWidth : child.minHeight;
          if (child.aspectRatio !== undefined && explicitMin === undefined) {
            let floor = transferRatioContent(
              child,
              childModel,
              isRow ? "height" : "width",
              ratioCrossContent(child, childModel) ?? 0,
            );
            const specified = isRow ? child.width : child.height;
            if (typeof specified === "number") {
              const specContent =
                child.boxSizing === "border-box"
                  ? Math.max(0, specified - paddingBorder)
                  : specified;
              floor = Math.min(specContent, floor);
            }
            if (floor > minContent) {
              minContent = floor;
              autoMinFromContent = true;
            }
          }
          if (maxContent < minContent) {
            // A content-based automatic minimum is capped by a definite max
            // main size; an explicit minimum wins over the max.
            if (autoMinFromContent) minContent = maxContent;
            else maxContent = minContent;
          }

          // Hypothetical main size = clamped flex base size (spec 9.3 step 4)
          const hypoMainSize = Math.max(
            minContent,
            Math.min(maxContent, flexBaseSize),
          );

          items.push({
            id: childId,
            flexBaseSize,
            hypoMainSize,
            paddingBorder,
            marginMain,
            flexGrow: child.flexGrow ?? 0,
            flexShrink: child.flexShrink ?? 1,
            minContent,
            maxContent,
            frozen: false,
            targetMainSize: hypoMainSize,
          });
        }

        // Step 1: Grow vs shrink
        const lineGapTotal = mainGap * Math.max(0, line.itemIds.length - 1);
        let totalOuterHypo = lineGapTotal;
        for (const item of items) {
          totalOuterHypo +=
            item.hypoMainSize + item.paddingBorder + item.marginMain;
        }
        const growing = totalOuterHypo < availableMainSize;

        // Step 2: Size inflexible items
        for (const item of items) {
          const flexFactor = growing ? item.flexGrow : item.flexShrink;
          if (flexFactor === 0) {
            item.targetMainSize = item.hypoMainSize;
            item.frozen = true;
          } else if (growing && item.flexBaseSize > item.hypoMainSize) {
            item.targetMainSize = item.hypoMainSize;
            item.frozen = true;
          } else if (!growing && item.flexBaseSize < item.hypoMainSize) {
            item.targetMainSize = item.hypoMainSize;
            item.frozen = true;
          }
        }

        // Step 4: Iterative clamping-and-refreeze loop
        for (let iter = 0; iter < 100; iter++) {
          const unfrozen = items.filter((it) => !it.frozen);
          if (unfrozen.length === 0) break;

          let remainingFreeSpace = availableMainSize - lineGapTotal;
          for (const item of items) {
            if (item.frozen) {
              remainingFreeSpace -=
                item.targetMainSize + item.paddingBorder + item.marginMain;
            } else {
              remainingFreeSpace -=
                item.flexBaseSize + item.paddingBorder + item.marginMain;
            }
          }

          let totalFlexFactor = 0;
          for (const item of unfrozen) {
            totalFlexFactor += growing ? item.flexGrow : item.flexShrink;
          }

          if (totalFlexFactor === 0) {
            for (const item of unfrozen) {
              item.targetMainSize = Math.max(
                item.minContent,
                Math.min(item.maxContent, item.flexBaseSize),
              );
              item.frozen = true;
            }
            break;
          }

          if (growing) {
            for (const item of unfrozen) {
              item.targetMainSize =
                item.flexBaseSize +
                (item.flexGrow / totalFlexFactor) * remainingFreeSpace;
            }
          } else {
            let totalScaledShrink = 0;
            for (const item of unfrozen) {
              totalScaledShrink += item.flexShrink * item.flexBaseSize;
            }
            for (const item of unfrozen) {
              if (totalScaledShrink > 0) {
                const ratio =
                  (item.flexShrink * item.flexBaseSize) / totalScaledShrink;
                item.targetMainSize =
                  item.flexBaseSize + ratio * remainingFreeSpace;
              } else {
                item.targetMainSize = item.flexBaseSize;
              }
            }
          }

          // Spec 9.7 step 4d-e: clamp, then freeze only one violation direction
          const adjustments: { item: FlexItemInfo; adj: number }[] = [];
          for (const item of unfrozen) {
            const unclamped = item.targetMainSize;
            const clamped = Math.max(
              0,
              Math.max(item.minContent, Math.min(item.maxContent, unclamped)),
            );
            const adj = clamped - unclamped;
            adjustments.push({ item, adj });
            item.targetMainSize = clamped;
          }

          const totalAdj = adjustments.reduce((s, a) => s + a.adj, 0);
          let anyFrozen = false;

          if (totalAdj === 0) {
            break;
          } else if (totalAdj > 0) {
            for (const { item, adj } of adjustments) {
              if (adj > 0) {
                item.frozen = true;
                anyFrozen = true;
              }
            }
          } else {
            for (const { item, adj } of adjustments) {
              if (adj < 0) {
                item.frozen = true;
                anyFrozen = true;
              }
            }
          }

          if (!anyFrozen) break;
        }

        // Apply resolved content-box sizes
        for (const item of items) {
          const childModel = boxModelMap.get(item.id)!;

          if (trace) {
            trace.resolvedMainSizes.set(
              item.id,
              item.targetMainSize + item.paddingBorder,
            );
            trace.frozenItems.set(
              item.id,
              item.targetMainSize <= item.minContent + 0.01 &&
                item.minContent > 0
                ? "min-clamped"
                : item.targetMainSize >= item.maxContent - 0.01 &&
                    item.maxContent < Infinity
                  ? "max-clamped"
                  : "flexible",
            );
          }

          if (isRow) {
            childModel.contentWidth = Math.max(0, item.targetMainSize);
          } else {
            childModel.contentHeight = Math.max(0, item.targetMainSize);
          }

          // Record that the parent resolved this child's main-axis dimension
          const resolvedDim: "width" | "height" = isRow ? "width" : "height";
          if (!parentResolvedDims.has(item.id))
            parentResolvedDims.set(item.id, new Set());
          parentResolvedDims.get(item.id)!.add(resolvedDim);
        }
      }

      // Phase 5.5a: Compute intrinsic sizes for nested flex containers
      for (const line of lines) {
        for (const childId of line.itemIds) {
          const child = nodeMap.get(childId)!;
          if (child.display === "flex") {
            const childIsRow =
              child.flexDirection === "row" ||
              child.flexDirection === "row-reverse" ||
              child.flexDirection === undefined;
            const childResolved = parentResolvedDims.get(childId);

            // Set intrinsic main-size if needed and not resolved by parent.
            // Width mains size like any inline cross axis: fit-content or
            // stretch against the container, not raw max-content.
            const mainDim: "width" | "height" = childIsRow ? "width" : "height";
            if (
              typeof child[mainDim] !== "number" &&
              !childResolved?.has(mainDim)
            ) {
              const childModel = boxModelMap.get(childId)!;
              const currentMain = childIsRow
                ? childModel.contentWidth
                : childModel.contentHeight;
              if (currentMain === 0) {
                let intrinsicMain: number | undefined;
                if (mainDim === "width") {
                  intrinsicMain = usedInlineSize(
                    node,
                    boxModelMap.get(node.id)!,
                    typeof node.width === "number" ||
                      (parentResolvedDims.get(node.id)?.has("width") ?? false),
                    child,
                    childModel,
                    nodeMap,
                    boxModelMap,
                  );
                  if (intrinsicMain === undefined) {
                    intrinsicMain = computeIntrinsicContentSize(
                      child,
                      "width",
                      nodeMap,
                      boxModelMap,
                      "max-content",
                    );
                  }
                } else {
                  intrinsicMain = computeIntrinsicContentSize(
                    child,
                    "height",
                    nodeMap,
                    boxModelMap,
                    "min-content",
                  );
                }
                if (childIsRow) {
                  childModel.contentWidth = intrinsicMain;
                } else {
                  childModel.contentHeight = intrinsicMain;
                }
                // Record so processNode(child) doesn't override
                if (!parentResolvedDims.has(childId))
                  parentResolvedDims.set(childId, new Set());
                parentResolvedDims.get(childId)!.add(mainDim);
              }
            }

            // Cross-size after main, so row children measure height at width
            const crossDim: "width" | "height" = childIsRow
              ? "height"
              : "width";
            if (
              typeof child[crossDim] !== "number" &&
              !childResolved?.has(crossDim)
            ) {
              const childModel = boxModelMap.get(childId)!;
              const alignVal =
                (child.alignSelf && child.alignSelf !== "auto"
                  ? child.alignSelf
                  : node.alignItems) ?? "stretch";
              const nonStretch =
                alignVal !== "stretch" ||
                child.margin.left === "auto" ||
                child.margin.right === "auto";
              let intrinsicCross: number | undefined;
              if (crossDim === "width" && nonStretch) {
                // Stretch children take their width from the line cross in
                // Phase 6; only non-stretched ones size to fit-content here.
                intrinsicCross = usedInlineSize(
                  node,
                  boxModelMap.get(node.id)!,
                  typeof node.width === "number" ||
                    (parentResolvedDims.get(node.id)?.has("width") ?? false),
                  child,
                  childModel,
                  nodeMap,
                  boxModelMap,
                );
                if (intrinsicCross !== undefined) {
                  if (!parentResolvedDims.has(childId))
                    parentResolvedDims.set(childId, new Set());
                  parentResolvedDims.get(childId)!.add("width");
                }
              }
              if (intrinsicCross === undefined) {
                const inline =
                  crossDim === "height" &&
                  (typeof child.width === "number" ||
                    parentResolvedDims.get(childId)?.has("width"))
                    ? childModel.contentWidth
                    : undefined;
                intrinsicCross = computeIntrinsicContentSize(
                  child,
                  crossDim,
                  nodeMap,
                  boxModelMap,
                  "min-content",
                  inline,
                );
              }
              if (childIsRow) {
                childModel.contentHeight = intrinsicCross;
              } else {
                childModel.contentWidth = intrinsicCross;
              }
            }
          } else if (child.display === "grid") {
            const childResolved = parentResolvedDims.get(childId);
            const crossDim: "width" | "height" = isRow ? "height" : "width";
            if (
              typeof child[crossDim] !== "number" &&
              !childResolved?.has(crossDim)
            ) {
              const childModel = boxModelMap.get(childId)!;
              const markResolved = () => {
                if (!parentResolvedDims.has(childId))
                  parentResolvedDims.set(childId, new Set());
                parentResolvedDims.get(childId)!.add(crossDim);
              };
              if (crossDim === "height") {
                childModel.contentHeight = computeIntrinsicContentSize(
                  child,
                  "height",
                  nodeMap,
                  boxModelMap,
                  "min-content",
                  childResolved?.has("width")
                    ? childModel.contentWidth
                    : undefined,
                );
                markResolved();
              } else {
                // Non-stretched inline size is fit-content:
                // clamp(min-content, available, max-content).
                const maxC = computeIntrinsicContentSize(
                  child,
                  "width",
                  nodeMap,
                  boxModelMap,
                  "max-content",
                );
                const minC = computeIntrinsicContentSize(
                  child,
                  "width",
                  nodeMap,
                  boxModelMap,
                  "min-content",
                );
                const containerWidthDefinite =
                  typeof node.width === "number" ||
                  (parentResolvedDims.get(node.id)?.has("width") ?? false);
                let fit = maxC;
                if (containerWidthDefinite) {
                  const nodeModel = boxModelMap.get(node.id)!;
                  const hPB =
                    childModel.paddingLeft +
                    childModel.paddingRight +
                    childModel.borderLeft +
                    childModel.borderRight;
                  const avail = Math.max(
                    0,
                    nodeModel.contentWidth -
                      childModel.marginLeft -
                      childModel.marginRight -
                      hPB,
                  );
                  fit = Math.max(minC, Math.min(maxC, avail));
                }
                childModel.contentWidth = clampCrossContent(
                  child,
                  fit,
                  childModel.paddingLeft +
                    childModel.paddingRight +
                    childModel.borderLeft +
                    childModel.borderRight,
                  false,
                );
                markResolved();
              }
            }
          }
        }
      }

      // Phase 5.5a2: Resolve cross sizes for measureContent items
      for (const line of lines) {
        for (const childId of line.itemIds) {
          const child = nodeMap.get(childId)!;
          if (child.measureContent && child.display !== "flex") {
            const crossDim: "width" | "height" = isRow ? "height" : "width";
            const hasDefiniteCross = typeof child[crossDim] === "number";
            if (!hasDefiniteCross) {
              const childModel = boxModelMap.get(childId)!;
              // Call measureContent with the resolved main-axis content size
              const resolvedMainContent = isRow
                ? childModel.contentWidth
                : childModel.contentHeight;
              if (isRow) {
                childModel.contentHeight =
                  child.measureContent(resolvedMainContent).height;
              } else {
                const ctm = columnTextMetrics(child, childModel);
                childModel.contentWidth = ctm
                  ? ctm.usedWidth
                  : child.measureContent(Infinity).width;
              }
            }
          }
        }
      }

      // Phase 5.5a3: Resolve aspect-ratio cross sizes from the used main size
      // so line cross sizing sees the transferred extent; stretch overrides
      // later in Phase 6.
      for (const line of lines) {
        for (const childId of line.itemIds) {
          const child = nodeMap.get(childId)!;
          if (!child.aspectRatio) continue;
          const crossProp: "width" | "height" = isRow ? "height" : "width";
          if (typeof child[crossProp] === "number") continue;
          const childModel = boxModelMap.get(childId)!;
          const usedMain = isRow
            ? childModel.contentWidth
            : childModel.contentHeight;
          const transferred = transferRatioContent(
            child,
            childModel,
            isRow ? "width" : "height",
            usedMain,
          );
          if (isRow) {
            childModel.contentHeight = transferred;
          } else {
            childModel.contentWidth = transferred;
          }
        }
      }

      // Phase 5.5b: Compute per-line cross sizes and align-content
      const containerCrossSize = isRow
        ? parentModel.contentHeight
        : parentModel.contentWidth;

      const lineLayouts: LineLayout[] = [];
      for (const line of lines) {
        let maxOuterCross = 0;
        let maxAscent = 0;
        let maxDescent = 0;
        let hasBaseline = false;
        for (const childId of line.itemIds) {
          const childModel = boxModelMap.get(childId)!;
          const crossPB = isRow
            ? childModel.paddingTop +
              childModel.paddingBottom +
              childModel.borderTop +
              childModel.borderBottom
            : childModel.paddingLeft +
              childModel.paddingRight +
              childModel.borderLeft +
              childModel.borderRight;
          const child = nodeMap.get(childId)!;
          const crossContent = clampCrossContent(
            child,
            isRow ? childModel.contentHeight : childModel.contentWidth,
            crossPB,
            isRow,
          );
          const crossMarginStart = isRow
            ? childModel.marginTop
            : childModel.marginLeft;
          const crossMarginEnd = isRow
            ? childModel.marginBottom
            : childModel.marginRight;
          maxOuterCross = Math.max(
            maxOuterCross,
            crossContent + crossPB + crossMarginStart + crossMarginEnd,
          );

          const effectiveAlign =
            (child.alignSelf && child.alignSelf !== "auto"
              ? child.alignSelf
              : node.alignItems) ?? "stretch";
          if (effectiveAlign === "baseline") {
            hasBaseline = true;
            const bbCross = crossContent + crossPB;
            const baselineOffset = isRow ? computeBaselineOffset(child) : 0;
            maxAscent = Math.max(maxAscent, crossMarginStart + baselineOffset);
            maxDescent = Math.max(
              maxDescent,
              crossMarginEnd + (bbCross - baselineOffset),
            );
          }
        }
        lineLayouts.push({
          itemIds: [...line.itemIds],
          crossSize: hasBaseline
            ? Math.max(maxOuterCross, maxAscent + maxDescent)
            : maxOuterCross,
          crossOffset: 0,
          baselineAscent: hasBaseline ? maxAscent : undefined,
          baselineDescent: hasBaseline ? maxDescent : undefined,
        });
      }

      // For auto cross-size containers: set container's cross-size from line content
      const crossDimName: "width" | "height" = isRow ? "height" : "width";
      const crossResolvedByParent =
        parentResolvedDims.get(node.id)?.has(crossDimName) ?? false;
      const hasCrossAuto = isRow
        ? typeof node.height !== "number"
        : typeof node.width !== "number";

      if (hasCrossAuto && !crossResolvedByParent) {
        const totalLineCross =
          lineLayouts.reduce((s, l) => s + l.crossSize, 0) +
          crossGap * Math.max(0, lineLayouts.length - 1);
        if (isRow) {
          parentModel.contentHeight = totalLineCross;
        } else {
          parentModel.contentWidth = totalLineCross;
        }
      }

      // Single-line nowrap: line cross size = container cross size (spec 9.4 step 8)
      const crossIsDefinite = !hasCrossAuto || crossResolvedByParent;
      if (!wrap && lineLayouts.length === 1 && crossIsDefinite) {
        lineLayouts[0].crossSize = containerCrossSize;
      }

      // Apply align-content for multi-line containers (wrap/wrap-reverse)
      if (wrap) {
        const totalLineCross =
          lineLayouts.reduce((s, l) => s + l.crossSize, 0) +
          crossGap * Math.max(0, lineLayouts.length - 1);
        const remainingCross = containerCrossSize - totalLineCross;
        const alignContent = node.alignContent ?? "stretch";
        const numLines = lineLayouts.length;

        let crossStart = 0;
        let interLineGap = 0;

        switch (alignContent) {
          case "flex-start":
            break;
          case "flex-end":
            crossStart = remainingCross;
            break;
          case "center":
            crossStart = remainingCross / 2;
            break;
          case "stretch":
            if (remainingCross > 0) {
              const extra = remainingCross / numLines;
              for (const ll of lineLayouts) {
                ll.crossSize += extra;
              }
            }
            break;
          case "space-between":
            if (remainingCross > 0 && numLines > 1) {
              interLineGap = remainingCross / (numLines - 1);
            }
            break;
          case "space-around":
            if (remainingCross > 0 && numLines > 0) {
              interLineGap = remainingCross / numLines;
              crossStart = interLineGap / 2;
            } else if (node.flexWrap === "wrap-reverse") {
              crossStart = remainingCross;
            }
            break;
          case "space-evenly":
            if (remainingCross > 0 && numLines > 0) {
              interLineGap = remainingCross / (numLines + 1);
              crossStart = interLineGap;
            } else if (node.flexWrap === "wrap-reverse") {
              crossStart = remainingCross;
            }
            break;
        }

        let curCrossOffset = crossStart;
        for (const ll of lineLayouts) {
          ll.crossOffset = curCrossOffset;
          curCrossOffset += ll.crossSize + interLineGap + crossGap;
        }
      }

      // Handle wrap-reverse: reverse line cross offsets
      if (node.flexWrap === "wrap-reverse") {
        for (const ll of lineLayouts) {
          ll.crossOffset = containerCrossSize - ll.crossOffset - ll.crossSize;
        }
      }

      containerLineLayouts.set(node.id, lineLayouts);

      // Phase 6: Resolve cross sizes per line
      for (const lineLayout of lineLayouts) {
        for (const childId of lineLayout.itemIds) {
          const child = nodeMap.get(childId)!;
          const childModel = boxModelMap.get(childId)!;

          const effectiveAlign =
            (child.alignSelf && child.alignSelf !== "auto"
              ? child.alignSelf
              : node.alignItems) ?? "stretch";

          const crossPaddingBorder = isRow
            ? childModel.paddingTop +
              childModel.paddingBottom +
              childModel.borderTop +
              childModel.borderBottom
            : childModel.paddingLeft +
              childModel.paddingRight +
              childModel.borderLeft +
              childModel.borderRight;

          const crossMargin = isRow
            ? childModel.marginTop + childModel.marginBottom
            : childModel.marginLeft + childModel.marginRight;

          const hasDefiniteCrossSize = isRow
            ? typeof child.height === "number"
            : typeof child.width === "number";

          const crossSizeProp = isRow ? child.height : child.width;
          if (crossSizeProp === "fit-content") {
            const crossDim: "width" | "height" = isRow ? "height" : "width";
            const availCross = Math.max(
              0,
              lineLayout.crossSize - crossMargin - crossPaddingBorder,
            );
            const inline = isRow ? childModel.contentWidth : undefined;
            const minC = computeIntrinsicContentSize(
              child,
              crossDim,
              nodeMap,
              boxModelMap,
              "min-content",
              inline,
            );
            const maxC = computeIntrinsicContentSize(
              child,
              crossDim,
              nodeMap,
              boxModelMap,
              "max-content",
              inline,
            );
            const fit = Math.max(minC, Math.min(maxC, availCross));
            if (isRow) {
              childModel.contentHeight = fit;
            } else {
              childModel.contentWidth = fit;
            }
            if (!parentResolvedDims.has(childId))
              parentResolvedDims.set(childId, new Set());
            parentResolvedDims.get(childId)!.add(crossDim);
          } else if (effectiveAlign === "stretch" && !hasDefiniteCrossSize) {
            const stretchedContent = Math.max(
              0,
              lineLayout.crossSize - crossMargin - crossPaddingBorder,
            );
            if (isRow) {
              childModel.contentHeight = stretchedContent;
            } else {
              childModel.contentWidth = stretchedContent;
            }
            // Record that parent resolved this child's cross dimension
            const stretchDim: "width" | "height" = isRow ? "height" : "width";
            if (!parentResolvedDims.has(childId))
              parentResolvedDims.set(childId, new Set());
            parentResolvedDims.get(childId)!.add(stretchDim);
          }

          const clamped = clampCrossContent(
            child,
            isRow ? childModel.contentHeight : childModel.contentWidth,
            crossPaddingBorder,
            isRow,
          );
          if (isRow) {
            childModel.contentHeight = clamped;
          } else {
            childModel.contentWidth = clamped;
          }

          const crossSize = isRow
            ? childModel.contentHeight + crossPaddingBorder
            : childModel.contentWidth + crossPaddingBorder;
          if (trace) {
            trace.resolvedCrossSizes.set(childId, crossSize);
          }
        }
      }
    } else if (node.display === "grid") {
      const model = boxModelMap.get(node.id)!;
      const { main: colGap, cross: rowGap } = resolveGaps(node, true);
      const resolvedDims = parentResolvedDims.get(node.id);
      const widthDefinite =
        typeof node.width === "number" || resolvedDims?.has("width") === true;
      const heightDefinite =
        typeof node.height === "number" || resolvedDims?.has("height") === true;
      const colExpansion = expandAutoRepeat(
        node.gridTemplateColumns,
        widthDefinite ? model.contentWidth : undefined,
        colGap,
      );
      const rowExpansion = expandAutoRepeat(
        node.gridTemplateRows,
        heightDefinite ? model.contentHeight : undefined,
        rowGap,
      );
      const colTracks = colExpansion.tracks;
      const rowTracks = rowExpansion.tracks;
      const gridItems = node.children.filter((child) => {
        const pos = child.position ?? "static";
        return (
          child.display !== "none" && pos !== "absolute" && pos !== "fixed"
        );
      });
      const flow = node.gridAutoFlow?.startsWith("column") ? "column" : "row";
      const dense = node.gridAutoFlow?.includes("dense") ?? false;
      const { placements, colCount, rowCount } = resolvePlacements(
        gridItems,
        colTracks.length,
        rowTracks.length,
        flow,
        dense,
      );

      const colTrackList = colTracks.slice();
      while (colTrackList.length < colCount) {
        colTrackList.push(node.gridAutoColumns ?? "auto");
      }
      const rowTrackList = rowTracks.slice();
      while (rowTrackList.length < rowCount) {
        rowTrackList.push(node.gridAutoRows ?? "auto");
      }

      let collapsedCols: boolean[] | undefined;
      if (colExpansion.autoFitEnd > colExpansion.autoFitStart) {
        collapsedCols = new Array<boolean>(colCount).fill(false);
        for (
          let i = colExpansion.autoFitStart;
          i < colExpansion.autoFitEnd;
          i++
        ) {
          collapsedCols[i] = true;
        }
        for (const p of placements.values()) {
          for (let i = p.colStart; i < p.colEnd && i < colCount; i++) {
            collapsedCols[i] = false;
          }
        }
      }
      let collapsedRows: boolean[] | undefined;
      if (rowExpansion.autoFitEnd > rowExpansion.autoFitStart) {
        collapsedRows = new Array<boolean>(rowCount).fill(false);
        for (
          let i = rowExpansion.autoFitStart;
          i < rowExpansion.autoFitEnd;
          i++
        ) {
          collapsedRows[i] = true;
        }
        for (const p of placements.values()) {
          for (let i = p.rowStart; i < p.rowEnd && i < rowCount; i++) {
            collapsedRows[i] = false;
          }
        }
      }

      // Column contributions (outer widths incl. margins).
      const colItems: TrackItemContribution[] = [];
      for (const child of gridItems) {
        const p = placements.get(child.id)!;
        const cm = boxModelMap.get(child.id)!;
        const hPBM =
          cm.paddingLeft +
          cm.paddingRight +
          cm.borderLeft +
          cm.borderRight +
          cm.marginLeft +
          cm.marginRight;
        const definiteW = typeof child.width === "number";
        const minW = definiteW
          ? cm.contentWidth
          : computeIntrinsicContentSize(
              child,
              "width",
              nodeMap,
              boxModelMap,
              "min-content",
            );
        const maxW = definiteW
          ? cm.contentWidth
          : computeIntrinsicContentSize(
              child,
              "width",
              nodeMap,
              boxModelMap,
              "max-content",
            );
        colItems.push({
          start: p.colStart,
          end: p.colEnd,
          min: minW + hPBM,
          max: maxW + hPBM,
        });
      }

      const colSizes = resolveTrackSizes(
        colTrackList,
        colCount,
        colGap,
        widthDefinite ? model.contentWidth : undefined,
        colItems,
        node.justifyContent === undefined,
        true,
        collapsedCols,
      );
      const colOffsets = trackOffsets(
        colSizes,
        colGap,
        widthDefinite ? model.contentWidth : undefined,
        node.justifyContent,
        collapsedCols,
      );

      // Resolve item widths before row contributions so width-dependent
      // content (text) reports its wrapped height at the used inline size.
      for (const child of gridItems) {
        const p = placements.get(child.id)!;
        const cm = boxModelMap.get(child.id)!;
        if (typeof child.width === "number") continue;
        const areaWidth =
          colOffsets[p.colEnd - 1] +
          colSizes[p.colEnd - 1] -
          colOffsets[p.colStart];
        const hPB =
          cm.paddingLeft + cm.paddingRight + cm.borderLeft + cm.borderRight;
        const canStretch =
          gridItemJustify(child, node) === "stretch" &&
          child.margin.left !== "auto" &&
          child.margin.right !== "auto";
        const vPB =
          cm.paddingTop + cm.paddingBottom + cm.borderTop + cm.borderBottom;
        // Ratio items distinguish explicit stretch (justifySelf/justifyItems
        // "stretch": fills the track, distorting the ratio) from normal
        // (unspecified: preserves the ratio — transfers from a definite or
        // explicitly-stretched block axis, and fills the track only when
        // nothing else is definite). Probe-verified.
        const justifyVal =
          child.justifySelf && child.justifySelf !== "auto"
            ? child.justifySelf
            : node.justifyItems;
        const alignVal =
          child.alignSelf && child.alignSelf !== "auto"
            ? child.alignSelf
            : node.alignItems;
        const noHMarginAuto =
          child.margin.left !== "auto" && child.margin.right !== "auto";
        const noVMarginAuto =
          child.margin.top !== "auto" && child.margin.bottom !== "auto";
        const justifyExplicitStretch =
          justifyVal === "stretch" && noHMarginAuto;
        const alignExplicitStretch = alignVal === "stretch" && noVMarginAuto;
        let content: number;
        if (child.width === "fit-content") {
          const minC = computeIntrinsicContentSize(
            child,
            "width",
            nodeMap,
            boxModelMap,
            "min-content",
          );
          const maxC = computeIntrinsicContentSize(
            child,
            "width",
            nodeMap,
            boxModelMap,
            "max-content",
          );
          const avail = Math.max(
            0,
            areaWidth - cm.marginLeft - cm.marginRight - hPB,
          );
          content = Math.max(minC, Math.min(maxC, avail));
        } else if (child.aspectRatio) {
          if (justifyExplicitStretch) {
            content = Math.max(
              0,
              areaWidth - cm.marginLeft - cm.marginRight - hPB,
            );
          } else if (typeof child.height === "number") {
            content = transferRatioContent(
              child,
              cm,
              "height",
              clampCrossContent(child, cm.contentHeight, vPB, true),
            );
          } else if (
            alignExplicitStretch ||
            (alignVal === undefined &&
              noVMarginAuto &&
              justifyVal !== undefined)
          ) {
            // Block axis fills (explicit stretch, or normal block paired
            // with an explicitly aligned inline axis); inline transfers.
            let fixedSpan: number | undefined = 0;
            for (let i = p.rowStart; i < p.rowEnd; i++) {
              const t = rowTrackList[i];
              if (typeof t !== "number") {
                fixedSpan = undefined;
                break;
              }
              fixedSpan += t;
            }
            if (fixedSpan !== undefined) {
              fixedSpan += rowGap * (p.rowEnd - p.rowStart - 1);
              const blockContent = clampCrossContent(
                child,
                Math.max(0, fixedSpan - cm.marginTop - cm.marginBottom - vPB),
                vPB,
                true,
              );
              content = transferRatioContent(child, cm, "height", blockContent);
            } else {
              content = transferRatioContent(
                child,
                cm,
                "height",
                clampCrossContent(child, 0, vPB, true),
              );
            }
          } else if (justifyVal === undefined && noHMarginAuto) {
            // Normal stretch floors at the ratio box's intrinsic inline size
            // (transferred from empty block content); explicit stretch does
            // not.
            content = Math.max(
              0,
              areaWidth - cm.marginLeft - cm.marginRight - hPB,
              transferRatioContent(
                child,
                cm,
                "height",
                clampCrossContent(child, 0, vPB, true),
              ),
            );
          } else {
            content = transferRatioContent(
              child,
              cm,
              "height",
              clampCrossContent(child, 0, vPB, true),
            );
          }
        } else if (canStretch) {
          content = Math.max(0, areaWidth - cm.marginLeft - cm.marginRight - hPB);
        } else {
          const maxContent = computeIntrinsicContentSize(
            child,
            "width",
            nodeMap,
            boxModelMap,
            "max-content",
          );
          if (child.measureContent && child.children.length === 0) {
            // fit-content: shrink to the area when the content overflows it,
            // never below the widest unbreakable piece (min-content).
            const minContent = computeIntrinsicContentSize(
              child,
              "width",
              nodeMap,
              boxModelMap,
              "min-content",
            );
            const avail = Math.max(
              0,
              areaWidth - cm.marginLeft - cm.marginRight - hPB,
            );
            content = Math.min(maxContent, Math.max(minContent, avail));
          } else {
            content = maxContent;
          }
        }
        cm.contentWidth = clampCrossContent(child, content, hPB, false);
        let dims = parentResolvedDims.get(child.id);
        if (!dims) {
          dims = new Set();
          parentResolvedDims.set(child.id, dims);
        }
        dims.add("width");
      }

      // Row contributions (outer heights incl. margins), measured at the
      // resolved inline size for width-dependent content.
      const rowItems: TrackItemContribution[] = [];
      for (const child of gridItems) {
        const p = placements.get(child.id)!;
        const cm = boxModelMap.get(child.id)!;
        const vPBM =
          cm.paddingTop +
          cm.paddingBottom +
          cm.borderTop +
          cm.borderBottom +
          cm.marginTop +
          cm.marginBottom;
        let minH: number;
        let maxH: number;
        if (typeof child.height === "number") {
          minH = maxH = cm.contentHeight;
        } else if (child.measureContent && child.children.length === 0) {
          minH = maxH = child.measureContent(cm.contentWidth).height;
        } else if (child.aspectRatio && child.children.length === 0) {
          minH = maxH = transferRatioContent(child, cm, "width", cm.contentWidth);
        } else if (child.children.length > 0) {
          minH = maxH = computeIntrinsicContentSize(
            child,
            "height",
            nodeMap,
            boxModelMap,
            "min-content",
            cm.contentWidth,
          );
        } else {
          minH = computeIntrinsicContentSize(
            child,
            "height",
            nodeMap,
            boxModelMap,
            "min-content",
          );
          maxH = computeIntrinsicContentSize(
            child,
            "height",
            nodeMap,
            boxModelMap,
            "max-content",
          );
        }
        rowItems.push({
          start: p.rowStart,
          end: p.rowEnd,
          min: minH + vPBM,
          max: maxH + vPBM,
        });
      }

      const rowSizes = resolveTrackSizes(
        rowTrackList,
        rowCount,
        rowGap,
        heightDefinite ? model.contentHeight : undefined,
        rowItems,
        node.alignContent === undefined || node.alignContent === "stretch",
        true,
        collapsedRows,
      );

      if (!heightDefinite) {
        let visibleRows = 0;
        let trackHeight = 0;
        for (let i = 0; i < rowSizes.length; i++) {
          if (collapsedRows?.[i]) continue;
          visibleRows++;
          trackHeight += rowSizes[i];
        }
        trackHeight += rowGap * Math.max(0, visibleRows - 1);
        model.contentHeight = clampCrossContent(
          node,
          trackHeight,
          model.paddingTop +
            model.paddingBottom +
            model.borderTop +
            model.borderBottom,
          true,
        );
      }

      const rowOffsets = trackOffsets(
        rowSizes,
        rowGap,
        heightDefinite ? model.contentHeight : undefined,
        node.alignContent,
        collapsedRows,
      );
      containerGridLayouts.set(node.id, {
        colSizes,
        rowSizes,
        colOffsets,
        rowOffsets,
        placements,
      });

      for (const child of gridItems) {
        const p = placements.get(child.id)!;
        const cm = boxModelMap.get(child.id)!;
        if (typeof child.height === "number") continue;
        const areaHeight =
          rowOffsets[p.rowEnd - 1] +
          rowSizes[p.rowEnd - 1] -
          rowOffsets[p.rowStart];
        const vPB =
          cm.paddingTop + cm.paddingBottom + cm.borderTop + cm.borderBottom;
        const canStretch =
          gridItemAlign(child, node) === "stretch" &&
          child.margin.top !== "auto" &&
          child.margin.bottom !== "auto";
        let content: number;
        const blockAlignVal =
          child.alignSelf && child.alignSelf !== "auto"
            ? child.alignSelf
            : node.alignItems;
        if (child.height === "fit-content") {
          const minC = computeIntrinsicContentSize(
            child,
            "height",
            nodeMap,
            boxModelMap,
            "min-content",
            cm.contentWidth,
          );
          const maxC = computeIntrinsicContentSize(
            child,
            "height",
            nodeMap,
            boxModelMap,
            "max-content",
            cm.contentWidth,
          );
          const avail = Math.max(
            0,
            areaHeight - cm.marginTop - cm.marginBottom - vPB,
          );
          content = Math.max(minC, Math.min(maxC, avail));
        } else if (
          child.aspectRatio &&
          !(blockAlignVal === "stretch" && canStretch)
        ) {
          content = transferRatioContent(child, cm, "width", cm.contentWidth);
        } else if (canStretch) {
          content = Math.max(0, areaHeight - cm.marginTop - cm.marginBottom - vPB);
        } else if (child.measureContent && child.children.length === 0) {
          content = child.measureContent(cm.contentWidth).height;
        } else {
          content = computeIntrinsicContentSize(
            child,
            "height",
            nodeMap,
            boxModelMap,
            "max-content",
          );
        }
        cm.contentHeight = clampCrossContent(child, content, vPB, true);
        let dims = parentResolvedDims.get(child.id);
        if (!dims) {
          dims = new Set();
          parentResolvedDims.set(child.id, dims);
        }
        dims.add("height");
      }
    }

    for (const child of node.children) {
      const pos = child.position ?? "static";
      if (pos === "absolute" || pos === "fixed") continue;
      processNode(child);
    }
  }
  processNode(normalizedRoot);

  // Phase 7: Produce final boxes
  function resolveAndEmitAbsolute(child: NormalizedLayoutNode, cb: ContainingBlockInfo) {
    const childModel = boxModelMap.get(child.id)!;

    const mL = child.margin.left === "auto" ? 0 : (child.margin.left as number);
    const mR = child.margin.right === "auto" ? 0 : (child.margin.right as number);
    const mT = child.margin.top === "auto" ? 0 : (child.margin.top as number);
    const mB = child.margin.bottom === "auto" ? 0 : (child.margin.bottom as number);
    childModel.marginLeft = mL;
    childModel.marginRight = mR;
    childModel.marginTop = mT;
    childModel.marginBottom = mB;

    const horizPB =
      childModel.paddingLeft +
      childModel.paddingRight +
      childModel.borderLeft +
      childModel.borderRight;
    const vertPB =
      childModel.paddingTop +
      childModel.paddingBottom +
      childModel.borderTop +
      childModel.borderBottom;

    const hasLeft = child.left !== undefined;
    const hasRight = child.right !== undefined;
    const hasTop = child.top !== undefined;
    const hasBottom = child.bottom !== undefined;

    // Resolve content width
    if (hasLeft && hasRight) {
      childModel.contentWidth = Math.max(
        0,
        cb.paddingBoxWidth - child.left! - child.right! - mL - mR - horizPB,
      );
    } else if (typeof child.width !== "number") {
      childModel.contentWidth = computeIntrinsicContentSize(
        child,
        "width",
        nodeMap,
        boxModelMap,
        "max-content",
      );
    }
    // else: contentWidth already set from resolveBoxModel

    // Resolve content height
    if (hasTop && hasBottom) {
      childModel.contentHeight = Math.max(
        0,
        cb.paddingBoxHeight - child.top! - child.bottom! - mT - mB - vertPB,
      );
    }
    // else: contentHeight already set from resolveBoxModel (or 0 for auto)

    // Mark dimensions as resolved so processNode doesn't override
    parentResolvedDims.set(child.id, new Set(["width", "height"]));

    // Process the absolute child's internal layout now that its size is known
    processNode(child);

    const childBorderBoxWidth = childModel.contentWidth + horizPB;
    const childBorderBoxHeight = childModel.contentHeight + vertPB;

    // Compute X position
    let childBorderBoxX: number;
    if (hasLeft) {
      childBorderBoxX = cb.paddingBoxX + child.left! + mL;
    } else if (hasRight) {
      childBorderBoxX =
        cb.paddingBoxX + cb.paddingBoxWidth - child.right! - mR - childBorderBoxWidth;
    } else {
      childBorderBoxX = cb.paddingBoxX + mL;
    }

    // Compute Y position
    let childBorderBoxY: number;
    if (hasTop) {
      childBorderBoxY = cb.paddingBoxY + child.top! + mT;
    } else if (hasBottom) {
      childBorderBoxY =
        cb.paddingBoxY + cb.paddingBoxHeight - child.bottom! - mB - childBorderBoxHeight;
    } else {
      childBorderBoxY = cb.paddingBoxY + mT;
    }

    emitBoxes(child, childBorderBoxX, childBorderBoxY, cb);
  }

  function emitBoxes(
    node: NormalizedLayoutNode,
    borderBoxX: number,
    borderBoxY: number,
    inheritedCB: ContainingBlockInfo,
  ) {
    const model = boxModelMap.get(node.id)!;
    const borderBoxWidth =
      model.contentWidth +
      model.paddingLeft +
      model.paddingRight +
      model.borderLeft +
      model.borderRight;
    const borderBoxHeight =
      model.contentHeight +
      model.paddingTop +
      model.paddingBottom +
      model.borderTop +
      model.borderBottom;

    const box: ResolvedBox = {
      id: node.id,
      x: borderBoxX,
      y: borderBoxY,
      width: model.contentWidth,
      height: model.contentHeight,
      padding: {
        top: model.paddingTop,
        right: model.paddingRight,
        bottom: model.paddingBottom,
        left: model.paddingLeft,
      },
      border: {
        top: model.borderTop,
        right: model.borderRight,
        bottom: model.borderBottom,
        left: model.borderLeft,
      },
      margin: {
        top: model.marginTop,
        right: model.marginRight,
        bottom: model.marginBottom,
        left: model.marginLeft,
      },
      borderBoxWidth,
      borderBoxHeight,
      outerWidth: borderBoxWidth + model.marginLeft + model.marginRight,
      outerHeight: borderBoxHeight + model.marginTop + model.marginBottom,
    };

    result.boxes.set(node.id, box);
    if (trace) {
      trace.boxes.set(node.id, box);
    }

    const contentBoxX = borderBoxX + model.borderLeft + model.paddingLeft;
    const contentBoxY = borderBoxY + model.borderTop + model.paddingTop;

    // Determine containing block for this node's absolutely-positioned children
    const nodePosition = node.position ?? "static";
    const isPositioned = nodePosition !== "static";
    const myCB: ContainingBlockInfo = isPositioned
      ? {
          paddingBoxX: borderBoxX + model.borderLeft,
          paddingBoxY: borderBoxY + model.borderTop,
          paddingBoxWidth:
            model.contentWidth + model.paddingLeft + model.paddingRight,
          paddingBoxHeight:
            model.contentHeight + model.paddingTop + model.paddingBottom,
        }
      : inheritedCB;

    const isFlex = node.display === "flex";
    const isRow =
      isFlex &&
      (node.flexDirection === "row" ||
        node.flexDirection === "row-reverse" ||
        node.flexDirection === undefined);
    const isMainReverse =
      isFlex &&
      (node.flexDirection === "row-reverse" ||
        node.flexDirection === "column-reverse");

    if (isFlex) {
      const { main: mainGap } = resolveGaps(node, isRow);
      const lineLayouts = containerLineLayouts.get(node.id) ?? [];
      const wrapReverse = node.flexWrap === "wrap-reverse";
      const containerCrossContentSize = isRow
        ? model.contentHeight
        : model.contentWidth;
      // Build child lookup by id
      const childById = new Map<string, NormalizedLayoutNode>();
      for (const child of node.children) {
        childById.set(child.id, child);
      }

      for (const lineLayout of lineLayouts) {
        const lineItems = lineLayout.itemIds.map((id) => childById.get(id)!);

        // --- Justify-content / auto margins for this line ---
        let mainAxisOffset = 0;
        let interItemGap = 0;

        const containerMainSize = isRow
          ? model.contentWidth
          : model.contentHeight;

        let totalOuterMain = 0;
        let autoMarginCount = 0;

        for (const child of lineItems) {
          const cm = boxModelMap.get(child.id)!;
          const borderBox = isRow
            ? cm.contentWidth +
              cm.paddingLeft +
              cm.paddingRight +
              cm.borderLeft +
              cm.borderRight
            : cm.contentHeight +
              cm.paddingTop +
              cm.paddingBottom +
              cm.borderTop +
              cm.borderBottom;
          const marginStart = isRow ? cm.marginLeft : cm.marginTop;
          const marginEnd = isRow ? cm.marginRight : cm.marginBottom;
          totalOuterMain += marginStart + borderBox + marginEnd;

          const origMargin = child.margin;
          if (isRow) {
            if (origMargin.left === "auto") autoMarginCount++;
            if (origMargin.right === "auto") autoMarginCount++;
          } else {
            if (origMargin.top === "auto") autoMarginCount++;
            if (origMargin.bottom === "auto") autoMarginCount++;
          }
        }
        totalOuterMain += mainGap * Math.max(0, lineItems.length - 1);

        const remainingSpace = containerMainSize - totalOuterMain;

        if (autoMarginCount > 0) {
          const perAutoMargin =
            remainingSpace > 0 ? remainingSpace / autoMarginCount : 0;

          for (const child of lineItems) {
            const cm = boxModelMap.get(child.id)!;
            const origMargin = child.margin;

            if (isRow) {
              if (origMargin.left === "auto") cm.marginLeft = perAutoMargin;
              if (origMargin.right === "auto") cm.marginRight = perAutoMargin;
            } else {
              if (origMargin.top === "auto") cm.marginTop = perAutoMargin;
              if (origMargin.bottom === "auto") cm.marginBottom = perAutoMargin;
            }
          }
        } else {
          const n = lineItems.length;
          const justifyContent = node.justifyContent ?? "flex-start";

          switch (justifyContent) {
            case "flex-end":
              mainAxisOffset = remainingSpace;
              break;
            case "center":
              mainAxisOffset = remainingSpace / 2;
              break;
            case "space-between":
              if (remainingSpace > 0 && n > 1) {
                interItemGap = remainingSpace / (n - 1);
              }
              break;
            case "space-around":
              if (remainingSpace > 0 && n > 0) {
                interItemGap = remainingSpace / n;
                mainAxisOffset = interItemGap / 2;
              }
              // negative free space → safe alignment: fall back to flex-start (offset stays 0)
              break;
            case "space-evenly":
              if (remainingSpace > 0 && n > 0) {
                interItemGap = remainingSpace / (n + 1);
                mainAxisOffset = interItemGap;
              }
              // negative free space → safe alignment: fall back to flex-start (offset stays 0)
              break;
            case "flex-start":
            default:
              break;
          }
        }

        // For reverse directions with negative remaining space,
        // Chromium uses safe alignment for space-around/space-evenly:
        // prevent overflow at main-end (fall back to flex-end behavior)
        if (isMainReverse && remainingSpace < 0) {
          const jc = node.justifyContent ?? "flex-start";
          if (jc === "space-around" || jc === "space-evenly") {
            mainAxisOffset = remainingSpace;
          }
        }

        // --- Position items in this line ---
        let currentMainPos = isMainReverse
          ? containerMainSize - mainAxisOffset
          : mainAxisOffset;

        for (const child of lineItems) {
          const childModel = boxModelMap.get(child.id)!;

          const childBorderBoxWidth =
            childModel.contentWidth +
            childModel.paddingLeft +
            childModel.paddingRight +
            childModel.borderLeft +
            childModel.borderRight;

          const childBorderBoxHeight =
            childModel.contentHeight +
            childModel.paddingTop +
            childModel.paddingBottom +
            childModel.borderTop +
            childModel.borderBottom;

          const crossBorderBox = isRow
            ? childBorderBoxHeight
            : childBorderBoxWidth;

          // Resolve cross-axis auto margins within this line
          const origMargin = child.margin;
          const crossStartAuto = isRow
            ? origMargin.top === "auto"
            : origMargin.left === "auto";
          const crossEndAuto = isRow
            ? origMargin.bottom === "auto"
            : origMargin.right === "auto";

          let itemCrossOffset: number;

          if (crossStartAuto || crossEndAuto) {
            const nonAutoStart = isRow
              ? childModel.marginTop
              : childModel.marginLeft;
            const nonAutoEnd = isRow
              ? childModel.marginBottom
              : childModel.marginRight;
            const remainingCross =
              lineLayout.crossSize - crossBorderBox - nonAutoStart - nonAutoEnd;
            const crossFreeSpace = Math.max(0, remainingCross);

            if (crossStartAuto && crossEndAuto) {
              const each = crossFreeSpace / 2;
              if (isRow) {
                childModel.marginTop = each;
                childModel.marginBottom = each;
              } else {
                childModel.marginLeft = each;
                childModel.marginRight = each;
              }
              itemCrossOffset = each;
            } else if (crossStartAuto) {
              if (isRow) {
                childModel.marginTop = crossFreeSpace;
              } else {
                childModel.marginLeft = crossFreeSpace;
              }
              itemCrossOffset = crossFreeSpace;
            } else {
              // crossEndAuto
              if (isRow) {
                childModel.marginBottom = crossFreeSpace;
              } else {
                childModel.marginRight = crossFreeSpace;
              }
              itemCrossOffset = isRow
                ? childModel.marginTop
                : childModel.marginLeft;
            }
          } else {
            // Normal alignment (no cross-axis auto margins)
            const effectiveAlign =
              (child.alignSelf && child.alignSelf !== "auto"
                ? child.alignSelf
                : node.alignItems) ?? "stretch";

            const crossMarginStart = isRow
              ? childModel.marginTop
              : childModel.marginLeft;
            const crossMarginEnd = isRow
              ? childModel.marginBottom
              : childModel.marginRight;
            const outerCross =
              crossBorderBox + crossMarginStart + crossMarginEnd;

            // For wrap-reverse, cross-start/end are swapped: swap flex-start/flex-end
            let resolvedAlign = effectiveAlign;
            if (wrapReverse) {
              if (
                resolvedAlign === "flex-start" ||
                resolvedAlign === "stretch"
              ) {
                resolvedAlign = "flex-end";
              } else if (resolvedAlign === "flex-end") {
                resolvedAlign = "flex-start";
              }
            }

            switch (resolvedAlign) {
              case "flex-end":
                itemCrossOffset =
                  lineLayout.crossSize - outerCross + crossMarginStart;
                break;
              case "center":
                itemCrossOffset =
                  (lineLayout.crossSize - outerCross) / 2 + crossMarginStart;
                break;
              case "baseline":
                if (lineLayout.baselineAscent !== undefined) {
                  const baselineOffset = isRow
                    ? computeBaselineOffset(child)
                    : 0;
                  // wrap-reverse flips the cross-start edge, so the baseline
                  // group anchors to the line's cross-end instead.
                  itemCrossOffset = wrapReverse
                    ? lineLayout.crossSize -
                      (lineLayout.baselineDescent ?? 0) -
                      baselineOffset
                    : lineLayout.baselineAscent - baselineOffset;
                } else {
                  itemCrossOffset = crossMarginStart;
                }
                break;
              case "flex-start":
              default:
                itemCrossOffset = crossMarginStart;
                break;
            }
          }

          const mainBorderBox = isRow
            ? childBorderBoxWidth
            : childBorderBoxHeight;

          let mainMarginStart: number;
          let mainMarginEnd: number;
          if (isMainReverse) {
            mainMarginStart = isRow
              ? childModel.marginRight
              : childModel.marginBottom;
            mainMarginEnd = isRow
              ? childModel.marginLeft
              : childModel.marginTop;
          } else {
            mainMarginStart = isRow
              ? childModel.marginLeft
              : childModel.marginTop;
            mainMarginEnd = isRow
              ? childModel.marginRight
              : childModel.marginBottom;
          }

          let childBorderBoxX: number;
          let childBorderBoxY: number;

          if (isMainReverse) {
            currentMainPos -= mainMarginStart + mainBorderBox;
            if (isRow) {
              childBorderBoxX = contentBoxX + currentMainPos;
              childBorderBoxY =
                contentBoxY + lineLayout.crossOffset + itemCrossOffset;
            } else {
              childBorderBoxX =
                contentBoxX + lineLayout.crossOffset + itemCrossOffset;
              childBorderBoxY = contentBoxY + currentMainPos;
            }
            currentMainPos -= mainMarginEnd + interItemGap + mainGap;
          } else {
            if (isRow) {
              childBorderBoxX = contentBoxX + currentMainPos + mainMarginStart;
              childBorderBoxY =
                contentBoxY + lineLayout.crossOffset + itemCrossOffset;
            } else {
              childBorderBoxX =
                contentBoxX + lineLayout.crossOffset + itemCrossOffset;
              childBorderBoxY = contentBoxY + currentMainPos + mainMarginStart;
            }
            currentMainPos +=
              mainMarginStart + mainBorderBox + mainMarginEnd + interItemGap + mainGap;
          }

          emitBoxes(child, childBorderBoxX, childBorderBoxY, myCB);
        }
      }
    } else if (node.display === "grid") {
      const grid = containerGridLayouts.get(node.id);
      if (grid) {
        for (const child of node.children) {
          if (child.display === "none") continue;
          const pos = child.position ?? "static";
          if (pos === "absolute" || pos === "fixed") continue;
          const p = grid.placements.get(child.id);
          if (!p) continue;
          const cm = boxModelMap.get(child.id)!;
          const areaX = grid.colOffsets[p.colStart];
          const areaW =
            grid.colOffsets[p.colEnd - 1] +
            grid.colSizes[p.colEnd - 1] -
            areaX;
          const areaY = grid.rowOffsets[p.rowStart];
          const areaH =
            grid.rowOffsets[p.rowEnd - 1] +
            grid.rowSizes[p.rowEnd - 1] -
            areaY;
          const bbW =
            cm.contentWidth +
            cm.paddingLeft +
            cm.paddingRight +
            cm.borderLeft +
            cm.borderRight;
          const bbH =
            cm.contentHeight +
            cm.paddingTop +
            cm.paddingBottom +
            cm.borderTop +
            cm.borderBottom;

          // Chromium reports auto margins on grid items as 0; they offset the
          // item without materializing in the resolved margin box.
          let offsetX: number;
          if (child.margin.left === "auto" || child.margin.right === "auto") {
            const freeW = Math.max(
              0,
              areaW - bbW - cm.marginLeft - cm.marginRight,
            );
            if (child.margin.left === "auto" && child.margin.right === "auto") {
              offsetX = cm.marginLeft + freeW / 2;
            } else if (child.margin.left === "auto") {
              offsetX = cm.marginLeft + freeW;
            } else {
              offsetX = cm.marginLeft;
            }
          } else {
            switch (gridItemJustify(child, node)) {
              case "end":
                offsetX = areaW - bbW - cm.marginRight;
                break;
              case "center":
                offsetX =
                  cm.marginLeft +
                  (areaW - bbW - cm.marginLeft - cm.marginRight) / 2;
                break;
              default:
                offsetX = cm.marginLeft;
            }
          }

          let offsetY: number;
          if (child.margin.top === "auto" || child.margin.bottom === "auto") {
            const freeH = Math.max(
              0,
              areaH - bbH - cm.marginTop - cm.marginBottom,
            );
            if (
              child.margin.top === "auto" &&
              child.margin.bottom === "auto"
            ) {
              offsetY = cm.marginTop + freeH / 2;
            } else if (child.margin.top === "auto") {
              offsetY = cm.marginTop + freeH;
            } else {
              offsetY = cm.marginTop;
            }
          } else {
            switch (gridItemAlign(child, node)) {
              case "end":
                offsetY = areaH - bbH - cm.marginBottom;
                break;
              case "center":
                offsetY =
                  cm.marginTop +
                  (areaH - bbH - cm.marginTop - cm.marginBottom) / 2;
                break;
              default:
                offsetY = cm.marginTop;
            }
          }

          emitBoxes(
            child,
            contentBoxX + areaX + offsetX,
            contentBoxY + areaY + offsetY,
            myCB,
          );
        }
      }
    } else {
      // Block layout
      let currentMainPos = 0;
      for (const child of node.children) {
        if (child.display === "none") continue;
        const childPos = child.position ?? "static";
        if (childPos === "absolute" || childPos === "fixed") continue;

        const childModel = boxModelMap.get(child.id)!;
        const childBorderBoxHeight =
          childModel.contentHeight +
          childModel.paddingTop +
          childModel.paddingBottom +
          childModel.borderTop +
          childModel.borderBottom;

        const childBorderBoxX = contentBoxX + childModel.marginLeft;
        const childBorderBoxY =
          contentBoxY + currentMainPos + childModel.marginTop;
        currentMainPos +=
          childModel.marginTop + childBorderBoxHeight + childModel.marginBottom;

        emitBoxes(child, childBorderBoxX, childBorderBoxY, myCB);
      }
    }

    // Resolve absolutely/fixed-positioned children after in-flow layout
    for (const child of node.children) {
      if (child.display === "none") continue;
      const childPos = child.position ?? "static";
      if (childPos !== "absolute" && childPos !== "fixed") continue;
      const cb = childPos === "fixed" ? rootContainingBlock : myCB;
      resolveAndEmitAbsolute(child, cb);
    }
  }

  const rootModel = boxModelMap.get(normalizedRoot.id)!;
  const rootBorderBoxX = -(rootModel.borderLeft + rootModel.paddingLeft);
  const rootBorderBoxY = -(rootModel.borderTop + rootModel.paddingTop);

  // Root is always a containing block (acts as the viewport in off-DOM context)
  rootContainingBlock = {
    paddingBoxX: rootBorderBoxX + rootModel.borderLeft,
    paddingBoxY: rootBorderBoxY + rootModel.borderTop,
    paddingBoxWidth:
      rootModel.contentWidth + rootModel.paddingLeft + rootModel.paddingRight,
    paddingBoxHeight:
      rootModel.contentHeight + rootModel.paddingTop + rootModel.paddingBottom,
  };

  emitBoxes(normalizedRoot, rootBorderBoxX, rootBorderBoxY, rootContainingBlock);

  if (trace) {
    result.trace = trace;
  }

  return result;
}
