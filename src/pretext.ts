import { measureLineStats, prepareWithSegments } from "@chenglou/pretext";
import type { LayoutNode } from "./types.js";
import { snapToLayoutUnit, type MeasureContent } from "./text.js";

export interface TextOptions {
  /** CSS canvas font shorthand, e.g. "16px Arial"; keep in sync with the rendered CSS. */
  font: string;
  lineHeight: number;
}

/**
 * A Pretext-backed `measureContent`. `prepareWithSegments` runs a one-time
 * canvas measurement pass — it needs an `OffscreenCanvas` or DOM canvas and
 * throws in bare Node; for Node use `measureFromAdvances` from outlay/text.
 * Returned widths are floored to LayoutUnit so `min-width: auto` floors and
 * intrinsic track sizes agree with Chromium.
 */
export function measureText(
  content: string,
  opts: TextOptions,
): MeasureContent {
  if (content.length === 0) return () => ({ width: 0, height: 0 });
  const prepared = prepareWithSegments(content, opts.font);
  return (availableWidth) => {
    const { lineCount, maxLineWidth } = measureLineStats(
      prepared,
      availableWidth,
    );
    return {
      width: snapToLayoutUnit(maxLineWidth),
      height: Math.max(1, lineCount) * opts.lineHeight,
    };
  };
}

/** A text leaf node measured by Pretext; spread extra LayoutNode props onto it. */
export function text(
  content: string,
  opts: TextOptions & Omit<LayoutNode, "measureContent" | "children">,
): LayoutNode {
  const { font, lineHeight, ...props } = opts;
  return {
    display: "block",
    ...props,
    measureContent: measureText(content, { font, lineHeight }),
  };
}
