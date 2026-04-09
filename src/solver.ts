import {
  BoxSides,
  DebugTrace,
  FlexLineInfo,
  LayoutNode,
  LayoutResultWithTrace,
  ResolvedBox,
  ResolvedBoxModel,
  SolverOptions,
} from "./types";

const ZERO_SIDES: BoxSides = { top: 0, right: 0, bottom: 0, left: 0 };

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

function resolveBoxModel(node: LayoutNode): ResolvedBoxModel {
  let contentWidth = typeof node.width === "number" ? node.width : 0;
  let contentHeight = typeof node.height === "number" ? node.height : 0;

  const p = node.padding;
  const b = node.border;
  const m = node.margin;

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
    marginTop: m.top,
    marginRight: m.right,
    marginBottom: m.bottom,
    marginLeft: m.left,
  };
}

function collectFlexItems(node: LayoutNode): string[] {
  return node.children
    .filter((child) => child.display !== "none")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((child) => child.id);
}

function determineHypotheticalMainSize(
  child: LayoutNode,
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
  _availableMainSize: number,
  _wrap: boolean,
): FlexLineInfo[] {
  // Stub: single line with all items
  let totalMainSize = 0;
  for (const id of itemIds) {
    const model = boxModelMap.get(id)!;
    const margin = isRow
      ? model.marginLeft + model.marginRight
      : model.marginTop + model.marginBottom;
    totalMainSize += (hypotheticalMainSizes.get(id) ?? 0) + margin;
  }
  return [{ itemIds: [...itemIds], mainSize: totalMainSize }];
}

export function solveLayout(
  root: LayoutNode,
  options?: SolverOptions,
): LayoutResultWithTrace {
  const debug = options?.debug ?? false;
  const trace = debug ? createTrace() : undefined;

  const result: LayoutResultWithTrace = {
    boxes: new Map<string, ResolvedBox>(),
  };

  const nodeMap = new Map<string, LayoutNode>();
  const boxModelMap = new Map<string, ResolvedBoxModel>();

  // Phase 1: Resolve box models for all nodes
  function resolveAllBoxModels(node: LayoutNode) {
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
  resolveAllBoxModels(root);

  // Phase 2: Collect flex items (for flex containers)
  function processNode(node: LayoutNode) {
    if (node.display === "flex") {
      const itemOrder = collectFlexItems(node);
      if (trace) {
        trace.flexItemOrder.push(...itemOrder);
      }

      const isRow =
        node.flexDirection === "row" ||
        node.flexDirection === "row-reverse" ||
        node.flexDirection === undefined;

      // Phase 3: Determine hypothetical main sizes
      for (const childId of itemOrder) {
        const child = nodeMap.get(childId)!;
        const childModel = boxModelMap.get(childId)!;
        const mainSize = determineHypotheticalMainSize(
          child,
          childModel,
          isRow,
        );
        if (trace) {
          trace.hypotheticalMainSizes.set(childId, mainSize);
        }
      }

      // Phase 4: Collect into lines
      const parentModel = boxModelMap.get(node.id)!;
      const availableMainSize = isRow
        ? parentModel.contentWidth
        : parentModel.contentHeight;
      const wrap = node.flexWrap === "wrap" || node.flexWrap === "wrap-reverse";

      const lines = collectIntoLines(
        itemOrder,
        trace?.hypotheticalMainSizes ?? new Map(),
        boxModelMap,
        isRow,
        availableMainSize,
        wrap,
      );
      if (trace) {
        trace.flexLines.push(...lines);
      }

      // Phase 5: Resolve flexible lengths (W3C CSS Flexbox spec 9.7)
      // Internal calculations use content-box sizes.
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
          if (typeof child.flexBasis === "number") {
            flexBaseSize =
              child.boxSizing === "border-box"
                ? Math.max(0, child.flexBasis - paddingBorder)
                : child.flexBasis;
          } else {
            flexBaseSize = isRow
              ? childModel.contentWidth
              : childModel.contentHeight;
          }

          // Min/max in content-box terms
          let minContent = 0;
          let maxContent = Infinity;
          if (isRow) {
            if (child.minWidth !== undefined) {
              minContent =
                child.boxSizing === "border-box"
                  ? Math.max(0, child.minWidth - paddingBorder)
                  : child.minWidth;
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
            }
            if (child.maxHeight !== undefined) {
              maxContent =
                child.boxSizing === "border-box"
                  ? Math.max(0, child.maxHeight - paddingBorder)
                  : child.maxHeight;
            }
          }
          if (maxContent < minContent) maxContent = minContent;

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
        let totalOuterHypo = 0;
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

          let remainingFreeSpace = availableMainSize;
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
            // No violations at all
            break;
          } else if (totalAdj > 0) {
            // Net min violations: freeze only min-violation items
            for (const { item, adj } of adjustments) {
              if (adj > 0) {
                item.frozen = true;
                anyFrozen = true;
              }
            }
          } else {
            // Net max violations: freeze only max-violation items
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
        }
      }

      // Phase 6: Resolve cross sizes (stub)
      for (const childId of itemOrder) {
        const childModel = boxModelMap.get(childId)!;
        const crossSize = isRow
          ? childModel.contentHeight +
            childModel.paddingTop +
            childModel.paddingBottom +
            childModel.borderTop +
            childModel.borderBottom
          : childModel.contentWidth +
            childModel.paddingLeft +
            childModel.paddingRight +
            childModel.borderLeft +
            childModel.borderRight;
        if (trace) {
          trace.resolvedCrossSizes.set(childId, crossSize);
        }
      }
    }

    for (const child of node.children) {
      processNode(child);
    }
  }
  processNode(root);

  // Phase 7: Produce final boxes
  function emitBoxes(node: LayoutNode, borderBoxX: number, borderBoxY: number) {
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

    let currentChildX = 0;
    let currentChildY = 0;

    // Sort items if flex, otherwise DOM order
    const orderedChildren =
      node.display === "flex"
        ? [...node.children].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : node.children;

    const isRow =
      node.display === "flex" &&
      (node.flexDirection === "row" ||
        node.flexDirection === "row-reverse" ||
        node.flexDirection === undefined);
    const isColumn =
      node.display === "flex" &&
      (node.flexDirection === "column" ||
        node.flexDirection === "column-reverse");

    for (const child of orderedChildren) {
      if (child.display === "none") continue;

      const childModel = boxModelMap.get(child.id)!;
      const childBorderBoxX =
        contentBoxX + currentChildX + childModel.marginLeft;
      const childBorderBoxY =
        contentBoxY + currentChildY + childModel.marginTop;

      emitBoxes(child, childBorderBoxX, childBorderBoxY);

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

      if (isRow) {
        currentChildX +=
          childModel.marginLeft + childBorderBoxWidth + childModel.marginRight;
      } else if (isColumn) {
        currentChildY +=
          childModel.marginTop + childBorderBoxHeight + childModel.marginBottom;
      } else {
        // Block layout
        currentChildY +=
          childModel.marginTop + childBorderBoxHeight + childModel.marginBottom;
      }
    }
  }

  const rootModel = boxModelMap.get(root.id)!;
  const rootBorderBoxX = -(rootModel.borderLeft + rootModel.paddingLeft);
  const rootBorderBoxY = -(rootModel.borderTop + rootModel.paddingTop);
  emitBoxes(root, rootBorderBoxX, rootBorderBoxY);

  if (trace) {
    result.trace = trace;
  }

  return result;
}
