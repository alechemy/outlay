/**
 * Headless OG-image generator.
 *
 * Builds a 1200×630 social card whose layout is a real CSS Grid — non-uniform
 * fr columns, column and row spans, fr rows, nested flex tiles, and paragraph
 * text wrapped at the fr-resolved column width — solves it with `solveLayout`,
 * and paints boxes plus line-broken text to SVG. No browser, no WASM, no
 * async: the only inputs are the tree and the committed word advances
 * (word-metrics.json, captured once by capture-metrics.ts).
 *
 *   npx tsx pages/demos/og-image/generate.ts [output.svg]
 */

import * as fs from "fs";
import * as path from "path";
import { solveLayout } from "../../../src/solver";
import type { LayoutNode, ResolvedBox } from "../../../src/types";
import { snapToLayoutUnit, textNode } from "../../../src/text";
import { CARD, FONTS, wordsOf, type FontRole } from "./content";

interface RoleMetrics {
  spaceWidth: number;
  words: Record<string, number>;
}

const METRICS = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "word-metrics.json"), "utf8"),
) as Record<FontRole, RoleMetrics>;

interface Line {
  text: string;
  width: number;
}

function breakLines(role: FontRole, text: string, availableWidth: number): Line[] {
  const { spaceWidth, words: table } = METRICS[role];
  const words = wordsOf(text);
  const lines: Line[] = [];
  let lineWords: string[] = [];
  let lineWidth = 0;
  for (const word of words) {
    const advance = table[word];
    if (advance === undefined) {
      throw new Error(`no advance for "${word}" (${role}); re-run capture-metrics.ts`);
    }
    if (lineWords.length === 0) {
      lineWords = [word];
      lineWidth = advance;
    } else if (snapToLayoutUnit(lineWidth + spaceWidth + advance) <= availableWidth) {
      lineWords.push(word);
      lineWidth += spaceWidth + advance;
    } else {
      lines.push({ text: lineWords.join(" "), width: snapToLayoutUnit(lineWidth) });
      lineWords = [word];
      lineWidth = advance;
    }
  }
  if (lineWords.length > 0) {
    lines.push({ text: lineWords.join(" "), width: snapToLayoutUnit(lineWidth) });
  }
  return lines;
}

interface BoxStyle {
  fill?: string;
  stroke?: string;
  radius?: number;
}

interface TextStyle {
  role: FontRole;
  content: string;
  color: string;
  align?: "start" | "center";
}

const boxStyles = new Map<string, BoxStyle>();
const textStyles = new Map<string, TextStyle>();

function styled(id: string, style: BoxStyle, node: LayoutNode): LayoutNode {
  boxStyles.set(id, style);
  return { id, ...node };
}

function text(id: string, style: TextStyle, props?: Omit<LayoutNode, "measureContent" | "children">): LayoutNode {
  textStyles.set(id, style);
  const measure = (availableWidth: number) => {
    const lines = breakLines(style.role, style.content, availableWidth);
    const width = lines.reduce((max, l) => Math.max(max, l.width), 0);
    return { width, height: lines.length * FONTS[style.role].lineHeight };
  };
  return textNode(measure, { id, ...props });
}

const STAT_COLORS = ["#8ab4ff", "#7fe0c3", "#ffd479", "#f7a8d8"];

function buildCard(): LayoutNode {
  const statTiles = CARD.stats.map((stat, i) =>
    styled(`tile-${i}`, { fill: "#171c2c", stroke: "#252b41", radius: 16 }, {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: 10,
      padding: { left: 22, right: 22, top: 16, bottom: 16 },
      gridColumn: { start: 2 + (i % 2), end: "auto" },
      gridRow: { start: 2 + Math.floor(i / 2), end: "auto" },
      children: [
        text(`stat-value-${i}`, { role: "statValue", content: stat.value, color: STAT_COLORS[i] }),
        text(`stat-label-${i}`, { role: "statLabel", content: stat.label, color: "#7e8aa6" }),
      ],
    }),
  );

  const tagChips = CARD.tags.map((tag, i) =>
    styled(`chip-${i}`, { fill: "#141828", stroke: "#262c40", radius: 21 }, {
      display: "flex",
      padding: { left: 16, right: 16, top: 9, bottom: 9 },
      children: [text(`chip-text-${i}`, { role: "tag", content: tag, color: "#a9b6d3" })],
    }),
  );

  return styled("card", { fill: "url(#bg)", stroke: "#262c40" }, {
    display: "grid",
    width: 1200,
    height: 630,
    padding: { top: 64, right: 72, bottom: 60, left: 72 },
    gap: { row: 28, column: 44 },
    gridTemplateColumns: ["5fr", "2fr", "2fr"],
    gridTemplateRows: ["auto", "1fr", "1fr", "auto"],
    children: [
      text("title", { role: "title", content: CARD.title, color: "url(#titleGrad)" }, {
        gridColumn: { start: 1, end: "span 2" },
        gridRow: { start: 1, end: "auto" },
        alignSelf: "flex-end",
      }),
      styled("badge", { fill: "#191e2e", stroke: "#2b3148", radius: 22 }, {
        display: "flex",
        padding: { left: 18, right: 18, top: 8, bottom: 8 },
        gridColumn: { start: 3, end: "auto" },
        gridRow: { start: 1, end: "auto" },
        justifySelf: "end",
        alignSelf: "center",
        children: [text("badge-text", { role: "badge", content: CARD.badge, color: "#93a0bd" })],
      }),
      text("tagline", { role: "tagline", content: CARD.tagline, color: "#a8b3cc" }, {
        gridColumn: { start: 1, end: "auto" },
        gridRow: { start: 2, end: "span 2" },
        alignSelf: "center",
      }),
      ...statTiles,
      {
        id: "footer",
        display: "flex",
        alignItems: "center",
        gap: 12,
        gridColumn: { start: 1, end: "span 3" },
        gridRow: { start: 4, end: "auto" },
        children: [
          ...tagChips,
          { id: "footer-spacer", flexGrow: 1 },
          text("repo", { role: "tag", content: CARD.repo, color: "#66718c" }),
        ],
      },
    ],
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function walk(node: LayoutNode, out: string[]): void {
  if (node.id) out.push(node.id);
  for (const c of node.children ?? []) walk(c, out);
}

// Visual approximation for glyph placement only; the layout itself never uses it.
const ASCENT_RATIO = 0.76;

function toSvg(tree: LayoutNode, boxes: Map<string, ResolvedBox>): string {
  const root = boxes.get("card")!;
  const order: string[] = [];
  walk(tree, order);

  const W = root.borderBoxWidth;
  const H = root.borderBoxHeight;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(
    `<defs>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="#101321"/><stop offset="1" stop-color="#1a2036"/>`,
    `</linearGradient>`,
    `<linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0" stop-color="#8ab4ff"/><stop offset="1" stop-color="#c7a7ff"/>`,
    `</linearGradient>`,
    `</defs>`,
  );

  for (const id of order) {
    const b = boxes.get(id);
    if (!b) continue;
    const x = +(b.x - root.x).toFixed(2);
    const y = +(b.y - root.y).toFixed(2);

    const box = boxStyles.get(id);
    if (box) {
      const attrs = [
        `x="${x}" y="${y}"`,
        `width="${+b.borderBoxWidth.toFixed(2)}" height="${+b.borderBoxHeight.toFixed(2)}"`,
        box.radius ? `rx="${box.radius}"` : "",
        `fill="${box.fill ?? "none"}"`,
        box.stroke ? `stroke="${box.stroke}" stroke-width="1"` : "",
      ].filter(Boolean);
      parts.push(`<rect ${attrs.join(" ")}/>`);
    }

    const t = textStyles.get(id);
    if (t) {
      const font = FONTS[t.role];
      const cx = x + b.border.left + b.padding.left;
      const cy = y + b.border.top + b.padding.top;
      const lines = breakLines(t.role, t.content, b.width);
      const family = font.family.replace(/"/g, "'");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const baseline = cy + i * font.lineHeight + (font.lineHeight - font.size) / 2 + font.size * ASCENT_RATIO;
        const anchorX = t.align === "center" ? cx + b.width / 2 : cx;
        const anchor = t.align === "center" ? ` text-anchor="middle"` : "";
        parts.push(
          `<text x="${+anchorX.toFixed(2)}" y="${+baseline.toFixed(2)}" ` +
            `font-family="${family}" font-size="${font.size}" font-weight="${font.weight}" ` +
            `fill="${t.color}"${anchor} textLength="${+line.width.toFixed(2)}" ` +
            `lengthAdjust="spacingAndGlyphs">${esc(line.text)}</text>`,
        );
      }
    }
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function main() {
  const outPath = process.argv[2] ?? path.join(import.meta.dirname, "card.svg");
  const tree = buildCard();
  const t0 = performance.now();
  const { boxes } = solveLayout(tree);
  const ms = performance.now() - t0;
  fs.writeFileSync(outPath, toSvg(tree, boxes) + "\n");
  console.error(
    `Solved ${boxes.size} nodes in ${ms.toFixed(3)}ms → ${path.relative(process.cwd(), outPath)}`,
  );
}

main();
