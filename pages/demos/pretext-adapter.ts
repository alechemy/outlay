import { measureLineStats, prepareWithSegments } from "@chenglou/pretext";

/**
 * Adapts a Pretext text block to the layout engine's `measureContent` contract.
 *
 * `prepareWithSegments` runs the one-time canvas measurement pass; it requires
 * an `OffscreenCanvas` or a DOM canvas and throws in bare Node, so this only
 * runs in a browser or worker. The returned closure is the allocation-light
 * resize path the engine calls at each candidate width — `measureLineStats`
 * reports the wrapped line count and widest line, which map directly onto the
 * `{ width, height }` the engine expects (min-content = widest word at width 0,
 * max-content = single line at width Infinity).
 *
 * `font` is a CSS canvas font shorthand (e.g. "16px Arial"); keep it and
 * `lineHeight` in sync with the CSS used to render the same text.
 */
export function makeTextMeasure(
  text: string,
  font: string,
  lineHeight: number,
): (availableWidth: number) => { width: number; height: number } {
  if (text.length === 0) return () => ({ width: 0, height: 0 });
  const prepared = prepareWithSegments(text, font);
  return (availableWidth: number) => {
    const { lineCount, maxLineWidth } = measureLineStats(prepared, availableWidth);
    return { width: maxLineWidth, height: Math.max(1, lineCount) * lineHeight };
  };
}
