/**
 * SVG renderers over solved layouts.
 *
 * `renderToSvg` paints a solved tree with caller-supplied styles — fills,
 * strokes, rounded corners, and line-broken text — the presentation renderer
 * behind headless cards, reports, and OG images. `renderDebugSvg` draws every
 * resolved box with depth colors, ids, sizes, and grid track outlines from a
 * `DebugTrace` — a shareable picture of what the solver did.
 *
 * Both are pure string builders: no DOM, no dependencies, synchronous.
 * Text painting takes the caller's line breaker (see `breakLines` in
 * `outlay/text`) so painted lines always match the measured layout.
 */

import type {
  DebugTrace,
  LayoutNode,
  LayoutResult,
  ResolvedBox,
} from "./types.js";

export interface SvgTextLine {
  text: string;
  width: number;
}

export interface SvgTextStyle {
  /** Line-break the content at the resolved content width (see `breakLines`). */
  lines: (contentWidth: number) => SvgTextLine[];
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight?: number | string;
  color?: string;
  align?: "start" | "center" | "end";
  /** Ascent in px at fontSize; with `descent`, baselines follow the CSS half-leading model. */
  ascent?: number;
  descent?: number;
}

export interface SvgBoxStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  text?: SvgTextStyle;
}

export interface RenderToSvgOptions {
  style: (node: LayoutNode, box: ResolvedBox) => SvgBoxStyle | undefined;
  /** Raw content for a <defs> block (gradients, patterns). */
  defs?: string;
}

// Visual approximation for glyph placement when the caller supplies no font
// ascent; the layout itself never depends on it.
const FALLBACK_ASCENT_RATIO = 0.76;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

function num(v: number): number {
  return +v.toFixed(2);
}

interface WalkedNode {
  node: LayoutNode;
  box: ResolvedBox;
  depth: number;
}

function walk(node: LayoutNode, result: LayoutResult, depth: number, out: WalkedNode[]): void {
  const box = result.nodes.get(node);
  if (!box) return;
  out.push({ node, box, depth });
  for (const child of node.children ?? []) walk(child, result, depth + 1, out);
}

function textBaseline(style: SvgTextStyle, lineTop: number): number {
  if (style.ascent !== undefined) {
    const halfLeading = (style.lineHeight - (style.ascent + (style.descent ?? 0))) / 2;
    return lineTop + halfLeading + style.ascent;
  }
  return (
    lineTop +
    (style.lineHeight - style.fontSize) / 2 +
    style.fontSize * FALLBACK_ASCENT_RATIO
  );
}

function paintText(
  style: SvgTextStyle,
  box: ResolvedBox,
  x: number,
  y: number,
  out: string[],
): void {
  const contentLeft = x + box.border.left + box.padding.left;
  const contentTop = y + box.border.top + box.padding.top;
  const lines = style.lines(box.width);
  const anchor =
    style.align === "center" ? "middle" : style.align === "end" ? "end" : "start";
  const anchorX =
    style.align === "center"
      ? contentLeft + box.width / 2
      : style.align === "end"
        ? contentLeft + box.width
        : contentLeft;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const baseline = textBaseline(style, contentTop + i * style.lineHeight);
    const attrs = [
      `x="${num(anchorX)}" y="${num(baseline)}"`,
      `font-family="${escAttr(style.fontFamily)}"`,
      `font-size="${style.fontSize}"`,
      style.fontWeight !== undefined ? `font-weight="${style.fontWeight}"` : "",
      `fill="${escAttr(style.color ?? "#000")}"`,
      anchor !== "start" ? `text-anchor="${anchor}"` : "",
      line.width > 0
        ? `textLength="${num(line.width)}" lengthAdjust="spacingAndGlyphs"`
        : "",
    ].filter(Boolean);
    out.push(`<text ${attrs.join(" ")}>${esc(line.text)}</text>`);
  }
}

export function renderToSvg(
  tree: LayoutNode,
  result: LayoutResult,
  options: RenderToSvgOptions,
): string {
  const order: WalkedNode[] = [];
  walk(tree, result, 0, order);
  if (order.length === 0) {
    throw new Error("renderToSvg: no box resolved for the root node");
  }
  const root = order[0].box;
  const W = num(root.borderBoxWidth);
  const H = num(root.borderBoxHeight);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  );
  if (options.defs) parts.push(`<defs>${options.defs}</defs>`);

  for (const { node, box } of order) {
    const style = options.style(node, box);
    if (!style) continue;
    const x = num(box.x - root.x);
    const y = num(box.y - root.y);
    if (style.fill !== undefined || style.stroke !== undefined) {
      const attrs = [
        `x="${x}" y="${y}"`,
        `width="${num(box.borderBoxWidth)}" height="${num(box.borderBoxHeight)}"`,
        style.radius ? `rx="${style.radius}"` : "",
        `fill="${escAttr(style.fill ?? "none")}"`,
        style.stroke
          ? `stroke="${escAttr(style.stroke)}" stroke-width="${style.strokeWidth ?? 1}"`
          : "",
      ].filter(Boolean);
      parts.push(`<rect ${attrs.join(" ")}/>`);
    }
    if (style.text) paintText(style.text, box, x, y, parts);
  }

  parts.push("</svg>");
  return parts.join("\n");
}

export interface DebugSvgOptions {
  /** Pass `solveLayout(tree, { debug: true }).trace` to overlay grid tracks. */
  trace?: DebugTrace;
  padding?: number;
  showIds?: boolean;
  showSizes?: boolean;
}

const DEBUG_FILLS = [
  "#e8d5c4", "#c4d4e0", "#d4e0c4", "#e0d4c4",
  "#c4d8d4", "#dcc4e0", "#e0c4c4", "#c4c8e0",
];
const DEBUG_STROKE = "rgba(32,27,24,0.28)";
const DEBUG_TRACK_STROKE = "rgba(43,84,166,0.55)";

export function renderDebugSvg(
  tree: LayoutNode,
  result: LayoutResult,
  options: DebugSvgOptions = {},
): string {
  const pad = options.padding ?? 24;
  const showIds = options.showIds ?? true;
  const showSizes = options.showSizes ?? true;

  const order: WalkedNode[] = [];
  walk(tree, result, 0, order);
  if (order.length === 0) {
    throw new Error("renderDebugSvg: no box resolved for the root node");
  }
  const root = order[0].box;
  const W = num(root.borderBoxWidth + pad * 2);
  const H = num(root.borderBoxHeight + pad * 2);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
      `font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
  );
  parts.push(`<rect width="${W}" height="${H}" rx="14" fill="#f4f7f9"/>`);

  for (const { box, depth } of order) {
    const x = num(box.x - root.x + pad);
    const y = num(box.y - root.y + pad);
    const w = num(box.borderBoxWidth);
    const h = num(box.borderBoxHeight);
    const fill = depth === 0 ? "#ffffff" : DEBUG_FILLS[(depth - 1) % DEBUG_FILLS.length];
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ` +
        `fill="${fill}" stroke="${DEBUG_STROKE}" stroke-width="1"/>`,
    );
    if (showIds) {
      parts.push(
        `<text x="${num(x + 6)}" y="${num(y + 14)}" font-size="10" ` +
          `fill="rgba(32,27,24,0.7)">${esc(box.id)}</text>`,
      );
    }
    if (showSizes && w > 70 && h > 30) {
      parts.push(
        `<text x="${num(x + w - 6)}" y="${num(y + h - 6)}" font-size="9" text-anchor="end" ` +
          `fill="rgba(32,27,24,0.45)">${Math.round(box.width)}×${Math.round(box.height)}</text>`,
      );
    }
  }

  const gridLayouts = options.trace?.gridLayouts;
  if (gridLayouts) {
    for (const [containerId, info] of gridLayouts) {
      const container = result.boxes.get(containerId);
      if (!container) continue;
      const cx = container.x - root.x + pad + container.border.left + container.padding.left;
      const cy = container.y - root.y + pad + container.border.top + container.padding.top;
      const contentW = container.width;
      const contentH = container.height;
      for (let i = 0; i < info.colSizes.length; i++) {
        parts.push(
          `<rect x="${num(cx + info.colOffsets[i])}" y="${num(cy)}" ` +
            `width="${num(info.colSizes[i])}" height="${num(contentH)}" ` +
            `fill="none" stroke="${DEBUG_TRACK_STROKE}" stroke-width="1" stroke-dasharray="3 3"/>`,
        );
      }
      for (let i = 0; i < info.rowSizes.length; i++) {
        parts.push(
          `<rect x="${num(cx)}" y="${num(cy + info.rowOffsets[i])}" ` +
            `width="${num(contentW)}" height="${num(info.rowSizes[i])}" ` +
            `fill="none" stroke="${DEBUG_TRACK_STROKE}" stroke-width="1" stroke-dasharray="3 3"/>`,
        );
      }
    }
  }

  parts.push("</svg>");
  return parts.join("\n");
}
