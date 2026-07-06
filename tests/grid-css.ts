import { LayoutNode, TrackListEntry, TrackSize } from "../src/types";

function trackSizeToCSS(t: TrackSize): string {
  if (typeof t === "number") return `${t}px`;
  if (typeof t === "string") return t;
  if ("fitContent" in t) return `fit-content(${t.fitContent}px)`;
  const min = typeof t.min === "number" ? `${t.min}px` : t.min;
  const max = typeof t.max === "number" ? `${t.max}px` : t.max;
  return `minmax(${min}, ${max})`;
}

function trackListToCSS(entries: TrackListEntry[]): string {
  return entries
    .map((entry) =>
      typeof entry === "object" && entry !== null && "repeat" in entry
        ? `repeat(${entry.repeat}, ${entry.tracks.map(trackSizeToCSS).join(" ")})`
        : trackSizeToCSS(entry),
    )
    .join(" ");
}

function gridLineToCSS(line: {
  start: number | "auto";
  end: number | "auto" | `span ${number}`;
}): string {
  return `${line.start} / ${line.end}`;
}

/** Grid-specific style declarations shared by the fixture generator and the probe. */
export function gridStyleDeclarations(node: LayoutNode): string[] {
  const styles: string[] = [];
  if (node.display === "grid") {
    if (node.gridTemplateColumns)
      styles.push(
        `grid-template-columns: ${trackListToCSS(node.gridTemplateColumns)}`,
      );
    if (node.gridTemplateRows)
      styles.push(
        `grid-template-rows: ${trackListToCSS(node.gridTemplateRows)}`,
      );
    if (node.gridAutoColumns !== undefined)
      styles.push(`grid-auto-columns: ${trackSizeToCSS(node.gridAutoColumns)}`);
    if (node.gridAutoRows !== undefined)
      styles.push(`grid-auto-rows: ${trackSizeToCSS(node.gridAutoRows)}`);
    if (node.gridAutoFlow) styles.push(`grid-auto-flow: ${node.gridAutoFlow}`);
    if (node.justifyItems)
      styles.push(`justify-items: ${node.justifyItems}`);
  }
  if (node.gridColumn)
    styles.push(`grid-column: ${gridLineToCSS(node.gridColumn)}`);
  if (node.gridRow) styles.push(`grid-row: ${gridLineToCSS(node.gridRow)}`);
  if (node.justifySelf && node.justifySelf !== "auto")
    styles.push(`justify-self: ${node.justifySelf}`);
  return styles;
}
