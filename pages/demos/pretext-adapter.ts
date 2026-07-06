import { measureText } from "../../src/pretext.js";

/**
 * Adapts a Pretext text block to the layout engine's `measureContent` contract.
 * Thin wrapper over the packaged `outlay/pretext` adapter so the demos exercise
 * the same code path the published entry point ships.
 *
 * `font` is a CSS canvas font shorthand (e.g. "16px Arial"); keep it and
 * `lineHeight` in sync with the CSS used to render the same text.
 */
export function makeTextMeasure(
  text: string,
  font: string,
  lineHeight: number,
): (availableWidth: number) => { width: number; height: number } {
  return measureText(text, { font, lineHeight });
}
