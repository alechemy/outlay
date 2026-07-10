/**
 * HTML-with-inline-styles to a finished SVG string, in one call: layout by
 * `solveLayout`, text measured through `outlay/font` metrics, painted with the
 * `outlay/svg` renderer. The Satori shape, but Grid-capable — `parseHTML`
 * already speaks Flexbox and CSS Grid.
 *
 * Honest scope versus Satori (v1): SVG out only (no raster/PNG); solid CSS
 * colors only (no gradients, images, background-images, or box-shadows);
 * advances are the unshaped, unkerned per-glyph sums `outlay/font` produces, so
 * kerned pairs and ligature clusters come out a hair wider than a shaping
 * engine. Text properties inherit down the element tree like CSS; the paint
 * vocabulary is `background`/`background-color`, `border-radius`, and
 * `border-color` (a uniform, non-zero border paints an inset stroke).
 *
 * Border strokes are composited as inset overlay rects rather than routed
 * through `SvgBoxStyle.stroke`, whose SVG stroke would straddle the border-box
 * edge; insetting by strokeWidth/2 keeps the stroke inside the box like a CSS
 * border.
 */

import {
  parseHTML,
  type LineHeightDecl,
  type ParsedRenderStyle,
} from "./html.js";
import { solveLayout } from "./solver.js";
import { renderToSvg, type SvgBoxStyle, type SvgTextLine } from "./svg.js";
import {
  parseFont,
  spaceAdvance,
  wordAdvance,
  type FontMetrics,
} from "./font.js";
import { breakLines, measureFromAdvances } from "./text.js";
import type { LayoutNode, LayoutResult, ResolvedBox } from "./types.js";

export interface HtmlToSvgOptions {
  /** Family name (as written in font-family, matched case-insensitively) to parsed metrics or raw font bytes. */
  fonts: Record<string, FontMetrics | Uint8Array>;
  /** Family used when no font-family is declared on or above a text leaf. */
  defaultFont?: string;
}

export interface ResolvedTextStyle {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  color: string;
  align: "start" | "center" | "end";
  ascent: number;
  descent: number;
  words: string[];
  lines: (availableWidth: number) => SvgTextLine[];
}

export interface ResolvedRenderStyle {
  background?: string;
  borderRadius?: number;
  borderColor?: string;
  text?: ResolvedTextStyle;
}

export interface HtmlLayout {
  tree: LayoutNode;
  styles: Map<LayoutNode, ResolvedRenderStyle>;
}

interface TextContext {
  fontFamily?: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: LineHeightDecl;
  color: string;
  align: "start" | "center" | "end";
}

/**
 * Parse and resolve without painting: build the `LayoutNode` tree (text leaves
 * carry a `measureContent` from the resolved font), resolve inherited text and
 * paint styles per node, and hand both back so callers can solve or inspect
 * before rendering. `htmlToSvg` is this plus `solveLayout` plus `renderToSvg`.
 */
export function htmlToLayout(
  html: string,
  options: HtmlToSvgOptions,
): HtmlLayout {
  const rawStyles = new Map<LayoutNode, ParsedRenderStyle>();
  const tree = parseHTML(html, { styles: rawStyles });

  const fontCache = new Map<string, FontMetrics>();
  const getFont = (family: string): FontMetrics => {
    const key = family.toLowerCase();
    const cached = fontCache.get(key);
    if (cached) return cached;
    const entry = Object.entries(options.fonts).find(
      ([name]) => name.toLowerCase() === key,
    );
    if (!entry) {
      const known = Object.keys(options.fonts).join(", ") || "(none)";
      throw new Error(
        `htmlToSvg: no font registered for font-family "${family}"; known families: ${known}`,
      );
    }
    const value = entry[1];
    const metrics = value instanceof Uint8Array ? parseFont(value) : value;
    fontCache.set(key, metrics);
    return metrics;
  };

  const styles = new Map<LayoutNode, ResolvedRenderStyle>();

  const walk = (node: LayoutNode, inherited: TextContext): void => {
    const raw = rawStyles.get(node) ?? {};
    const ctx: TextContext = {
      fontFamily: raw.fontFamily ?? inherited.fontFamily,
      fontSize: raw.fontSize ?? inherited.fontSize,
      fontWeight: raw.fontWeight ?? inherited.fontWeight,
      lineHeight: raw.lineHeight ?? inherited.lineHeight,
      color: raw.color ?? inherited.color,
      align: raw.textAlign ?? inherited.align,
    };

    const resolved: ResolvedRenderStyle = {};
    if (raw.background) resolved.background = raw.background;
    if (raw.borderRadius !== undefined) resolved.borderRadius = raw.borderRadius;
    if (raw.borderColor) resolved.borderColor = raw.borderColor;
    if (raw.text !== undefined) {
      resolved.text = buildTextStyle(raw.text, ctx, node, getFont);
    }
    styles.set(node, resolved);

    for (const child of node.children ?? []) walk(child, ctx);
  };

  walk(tree, {
    fontFamily: options.defaultFont,
    fontSize: 16,
    fontWeight: 400,
    lineHeight: { kind: "normal" },
    color: "#000",
    align: "start",
  });

  return { tree, styles };
}

/** Render HTML-with-inline-styles to a finished SVG string. */
export function htmlToSvg(html: string, options: HtmlToSvgOptions): string {
  const { tree, styles } = htmlToLayout(html, options);
  const result = solveLayout(tree);
  const svg = renderToSvg(tree, result, {
    style: (node) => toBoxStyle(styles.get(node)),
  });
  const borders = borderOverlay(tree, result, styles);
  if (borders.length === 0) return svg;
  return svg.replace(/<\/svg>\s*$/, `${borders.join("\n")}\n</svg>`);
}

function buildTextStyle(
  content: string,
  ctx: TextContext,
  node: LayoutNode,
  getFont: (family: string) => FontMetrics,
): ResolvedTextStyle {
  if (!ctx.fontFamily) {
    throw new Error(
      `htmlToSvg: text "${snippet(content)}" has no font-family and no defaultFont was provided`,
    );
  }
  const font = getFont(ctx.fontFamily);
  const size = ctx.fontSize;
  const lineHeight = resolveLineHeight(ctx.lineHeight, size, font);
  const words = content.split(/\s+/).filter(Boolean);
  const advances = words.map((word) => wordAdvance(font, word, size));
  const spaceWidth = spaceAdvance(font, size);

  node.measureContent = measureFromAdvances(advances, { spaceWidth, lineHeight });

  const breaker = breakLines(advances, { spaceWidth });
  const lines = (availableWidth: number): SvgTextLine[] =>
    breaker(availableWidth).map((line) => ({
      text: words.slice(line.start, line.end).join(" "),
      width: line.width,
    }));

  const scale = size / font.unitsPerEm;
  return {
    content,
    fontFamily: ctx.fontFamily,
    fontSize: size,
    fontWeight: ctx.fontWeight,
    lineHeight,
    color: ctx.color,
    align: ctx.align,
    ascent: font.ascent * scale,
    descent: font.descent * scale,
    words,
    lines,
  };
}

function resolveLineHeight(
  lh: LineHeightDecl,
  size: number,
  font: FontMetrics,
): number {
  if (lh.kind === "px") return lh.value;
  if (lh.kind === "multiplier") return lh.value * size;
  return ((font.ascent + font.descent + font.lineGap) / font.unitsPerEm) * size;
}

function toBoxStyle(
  style: ResolvedRenderStyle | undefined,
): SvgBoxStyle | undefined {
  if (!style) return undefined;
  const out: SvgBoxStyle = {};
  if (style.background) out.fill = style.background;
  if (style.borderRadius) out.radius = style.borderRadius;
  if (style.text) {
    out.text = {
      lines: style.text.lines,
      fontFamily: style.text.fontFamily,
      fontSize: style.text.fontSize,
      lineHeight: style.text.lineHeight,
      fontWeight: style.text.fontWeight,
      color: style.text.color,
      align: style.text.align,
      ascent: style.text.ascent,
      descent: style.text.descent,
    };
  }
  if (out.fill === undefined && out.text === undefined) return undefined;
  return out;
}

function borderOverlay(
  tree: LayoutNode,
  result: LayoutResult,
  styles: Map<LayoutNode, ResolvedRenderStyle>,
): string[] {
  const root = result.nodes.get(tree);
  if (!root) return [];
  const out: string[] = [];
  const walk = (node: LayoutNode): void => {
    const box = result.nodes.get(node);
    const style = styles.get(node);
    if (box && style?.borderColor) emitBorder(box, root, style, out);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

function emitBorder(
  box: ResolvedBox,
  root: ResolvedBox,
  style: ResolvedRenderStyle,
  out: string[],
): void {
  const b = box.border;
  if (!(b.top > 0 && b.top === b.right && b.right === b.bottom && b.bottom === b.left))
    return;
  const sw = b.top;
  const x = num(box.x - root.x + sw / 2);
  const y = num(box.y - root.y + sw / 2);
  const w = num(box.borderBoxWidth - sw);
  const h = num(box.borderBoxHeight - sw);
  const rx = style.borderRadius ? Math.max(0, style.borderRadius - sw / 2) : 0;
  out.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${
      rx ? `rx="${num(rx)}" ` : ""
    }fill="none" stroke="${escAttr(style.borderColor!)}" stroke-width="${num(sw)}"/>`,
  );
}

function num(v: number): number {
  return +v.toFixed(2);
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function snippet(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed;
}
