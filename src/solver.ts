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
  availableMainSize: number,
  wrap: boolean,
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
      currentLineSize + outerHypo > availableMainSize
    ) {
      lines.push({ itemIds: currentLineIds, mainSize: currentLineSize });
      currentLineIds = [id];
      currentLineSize = outerHypo;
    } else {
      currentLineIds.push(id);
      currentLineSize += outerHypo;
    }
  }

  if (currentLineIds.length > 0) {
    lines.push({ itemIds: currentLineIds, mainSize: currentLineSize });
  }

  return lines;
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

  interface LineLayout {
    itemIds: string[];
    crossSize: number;
    crossOffset: number;
  }
  const containerLineLayouts = new Map<string, LineLayout[]>();

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
      const hypoMainSizes = new Map<string, number>();
      for (const childId of itemOrder) {
        const child = nodeMap.get(childId)!;
        const childModel = boxModelMap.get(childId)!;
        const mainSize = determineHypotheticalMainSize(
          child,
          childModel,
          isRow,
        );
        hypoMainSizes.set(childId, mainSize);
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
        hypoMainSizes,
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

      // Phase 5.5: Compute per-line cross sizes and align-content
      const containerCrossSize = isRow
        ? parentModel.contentHeight
        : parentModel.contentWidth;

      const lineLayouts: LineLayout[] = [];
      for (const line of lines) {
        let maxOuterCross = 0;
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
          const crossContent = isRow
            ? childModel.contentHeight
            : childModel.contentWidth;
          const crossMarg = isRow
            ? childModel.marginTop + childModel.marginBottom
            : childModel.marginLeft + childModel.marginRight;
          maxOuterCross = Math.max(
            maxOuterCross,
            crossContent + crossPB + crossMarg,
          );
        }
        lineLayouts.push({
          itemIds: [...line.itemIds],
          crossSize: maxOuterCross,
          crossOffset: 0,
        });
      }

      // Single-line nowrap: line cross size = container cross size (spec 9.4 step 8)
      // Multi-line (wrap/wrap-reverse): line cross size stays as natural max outer cross
      if (!wrap && lineLayouts.length === 1) {
        lineLayouts[0].crossSize = containerCrossSize;
      }

      // Apply align-content for multi-line containers (wrap/wrap-reverse)
      if (wrap) {
        const totalLineCross = lineLayouts.reduce((s, l) => s + l.crossSize, 0);
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
              // With wrap-reverse, cross-start is swapped so safe overflow → flex-end pre-flip
              crossStart = remainingCross;
            }
            // else: flex-start fallback (crossStart=0)
            break;
        }

        let curCrossOffset = crossStart;
        for (const ll of lineLayouts) {
          ll.crossOffset = curCrossOffset;
          curCrossOffset += ll.crossSize + interLineGap;
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

          if (effectiveAlign === "stretch" && !hasDefiniteCrossSize) {
            const stretchedContent = Math.max(
              0,
              lineLayout.crossSize - crossMargin - crossPaddingBorder,
            );
            if (isRow) {
              childModel.contentHeight = stretchedContent;
            } else {
              childModel.contentWidth = stretchedContent;
            }
          }

          const crossSize = isRow
            ? childModel.contentHeight + crossPaddingBorder
            : childModel.contentWidth + crossPaddingBorder;
          if (trace) {
            trace.resolvedCrossSizes.set(childId, crossSize);
          }
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

    const isFlex = node.display === "flex";
    const isRow =
      isFlex &&
      (node.flexDirection === "row" ||
        node.flexDirection === "row-reverse" ||
        node.flexDirection === undefined);

    if (isFlex) {
      const lineLayouts = containerLineLayouts.get(node.id) ?? [];
      const wrapReverse = node.flexWrap === "wrap-reverse";
      const containerCrossContentSize = isRow
        ? model.contentHeight
        : model.contentWidth;

      // Build child lookup by id
      const childById = new Map<string, LayoutNode>();
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
              } else {
                mainAxisOffset = remainingSpace / 2;
              }
              break;
            case "space-evenly":
              if (remainingSpace > 0 && n > 0) {
                interItemGap = remainingSpace / (n + 1);
                mainAxisOffset = interItemGap;
              } else {
                mainAxisOffset = remainingSpace / 2;
              }
              break;
            case "flex-start":
            default:
              break;
          }
        }

        // --- Position items in this line ---
        let currentMainPos = mainAxisOffset;

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
              case "flex-start":
              default:
                itemCrossOffset = crossMarginStart;
                break;
            }
          }

          const mainMarginStart = isRow
            ? childModel.marginLeft
            : childModel.marginTop;
          const mainMarginEnd = isRow
            ? childModel.marginRight
            : childModel.marginBottom;
          const mainBorderBox = isRow
            ? childBorderBoxWidth
            : childBorderBoxHeight;

          let childBorderBoxX: number;
          let childBorderBoxY: number;

          if (isRow) {
            childBorderBoxX = contentBoxX + currentMainPos + mainMarginStart;
            childBorderBoxY =
              contentBoxY + lineLayout.crossOffset + itemCrossOffset;
          } else {
            childBorderBoxX =
              contentBoxX + lineLayout.crossOffset + itemCrossOffset;
            childBorderBoxY = contentBoxY + currentMainPos + mainMarginStart;
          }

          // wrap-reverse line offsets already handled in processNode

          currentMainPos +=
            mainMarginStart + mainBorderBox + mainMarginEnd + interItemGap;

          emitBoxes(child, childBorderBoxX, childBorderBoxY);
        }
      }
    } else {
      // Block layout
      let currentMainPos = 0;
      for (const child of node.children) {
        if (child.display === "none") continue;

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

        emitBoxes(child, childBorderBoxX, childBorderBoxY);
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
