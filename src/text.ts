import type { LayoutNode } from "./types.js";

export type MeasureContent = NonNullable<LayoutNode["measureContent"]>;

/**
 * Chromium stores accumulated line widths and intrinsic text widths as
 * LayoutUnit (1/64px, floored); a measurer chasing Chromium to sub-pixel
 * precision must apply the same quantization.
 */
export const LAYOUT_UNIT = 1 / 64;

export function snapToLayoutUnit(width: number): number {
  return Math.floor(width / LAYOUT_UNIT) * LAYOUT_UNIT;
}

export interface WordMetricsTable {
  spaceWidth: number;
  lineHeight: number;
  words: Record<string, number>;
}

export interface TextLineBreak {
  /** Word index range [start, end) into the advances array. */
  start: number;
  end: number;
  /** Accumulated line width, floored to LayoutUnit. */
  width: number;
}

/**
 * Greedy line breaking over precomputed per-word advances, returning the word
 * ranges of each line — for renderers that need to paint the lines a
 * `measureFromAdvances` measurement implies. Same LayoutUnit-quantized fit
 * test, so the two always agree.
 */
export function breakLines(
  advances: number[],
  opts: { spaceWidth: number },
): (availableWidth: number) => TextLineBreak[] {
  const { spaceWidth } = opts;
  return (availableWidth) => {
    if (advances.length === 0) return [];
    const lines: TextLineBreak[] = [];
    let start = 0;
    let cur = advances[0];
    for (let i = 1; i < advances.length; i++) {
      const w = advances[i];
      if (snapToLayoutUnit(cur + spaceWidth + w) <= availableWidth) {
        cur += spaceWidth + w;
      } else {
        lines.push({ start, end: i, width: snapToLayoutUnit(cur) });
        start = i;
        cur = w;
      }
    }
    lines.push({ start, end: advances.length, width: snapToLayoutUnit(cur) });
    return lines;
  };
}

/**
 * Greedy line breaking over precomputed per-word advances — the same
 * algorithm and LayoutUnit quantization the fixture suite verifies against
 * Chromium. Node-safe: no canvas or DOM needed; capture the advances once
 * (e.g. in a browser or from a font metrics file) and reuse them anywhere.
 */
export function measureFromAdvances(
  advances: number[],
  opts: { spaceWidth: number; lineHeight: number },
): MeasureContent {
  const lines = breakLines(advances, opts);
  const { lineHeight } = opts;
  return (availableWidth) => {
    const broken = lines(availableWidth);
    if (broken.length === 0) return { width: 0, height: 0 };
    let maxLine = 0;
    for (const line of broken) {
      if (line.width > maxLine) maxLine = line.width;
    }
    return { width: maxLine, height: broken.length * lineHeight };
  };
}

/**
 * `measureFromAdvances` driven by a word-metrics table. Throws on a word with
 * no committed advance so a stale table fails loudly instead of measuring
 * wrong.
 */
export function measureFromWordWidths(
  text: string,
  table: WordMetricsTable,
): MeasureContent {
  const advances = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const advance = table.words[word];
      if (advance === undefined) {
        throw new Error(`no advance for "${word}" in the word-metrics table`);
      }
      return advance;
    });
  return measureFromAdvances(advances, table);
}

/** A text leaf node: a `measureContent` carrier with optional extra props. */
export function textNode(
  measure: MeasureContent,
  props?: Omit<LayoutNode, "measureContent" | "children">,
): LayoutNode {
  // display: flex would route sizing through empty-container intrinsics;
  // measureContent is only consulted on non-container boxes.
  return { display: "block", ...props, measureContent: measure };
}
