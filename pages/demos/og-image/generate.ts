/**
 * Headless OG-image generator.
 *
 * Builds a 1200×630 social card whose layout is a real CSS Grid — non-uniform
 * fr columns, column and row spans, fr rows, nested flex tiles, and paragraph
 * text wrapped at the fr-resolved column width — solves it with `solveLayout`,
 * and paints it with the `outlay/svg` renderer. No browser, no WASM, no
 * async: the only inputs are the tree and the committed word advances
 * (word-metrics.json, captured once by capture-metrics.ts).
 *
 *   npx tsx pages/demos/og-image/generate.ts [output.svg]
 */

import * as fs from "fs";
import * as path from "path";
import { solveLayout } from "../../../src/solver";
import { renderToSvg, type SvgBoxStyle, type SvgTextLine } from "../../../src/svg";
import { breakLines, measureFromAdvances, textNode } from "../../../src/text";
import type { LayoutNode } from "../../../src/types";
import { CARD, FONTS, wordsOf, type FontRole } from "./content";

interface RoleMetrics {
  spaceWidth: number;
  words: Record<string, number>;
}

const METRICS = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "word-metrics.json"), "utf8"),
) as Record<FontRole, RoleMetrics>;

const styles = new Map<string, SvgBoxStyle>();

function styled(id: string, style: SvgBoxStyle, node: LayoutNode): LayoutNode {
  styles.set(id, style);
  return { id, ...node };
}

function text(
  id: string,
  role: FontRole,
  content: string,
  color: string,
  props?: Omit<LayoutNode, "measureContent" | "children">,
): LayoutNode {
  const { spaceWidth, words: table } = METRICS[role];
  const words = wordsOf(content);
  const advances = words.map((word) => {
    const advance = table[word];
    if (advance === undefined) {
      throw new Error(`no advance for "${word}" (${role}); re-run capture-metrics.ts`);
    }
    return advance;
  });
  const font = FONTS[role];
  const breaker = breakLines(advances, { spaceWidth });
  const lines = (contentWidth: number): SvgTextLine[] =>
    breaker(contentWidth).map((l) => ({
      text: words.slice(l.start, l.end).join(" "),
      width: l.width,
    }));
  styles.set(id, {
    text: {
      lines,
      fontFamily: font.family,
      fontSize: font.size,
      fontWeight: font.weight,
      lineHeight: font.lineHeight,
      color,
    },
  });
  return textNode(
    measureFromAdvances(advances, { spaceWidth, lineHeight: font.lineHeight }),
    { id, ...props },
  );
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
        text(`stat-value-${i}`, "statValue", stat.value, STAT_COLORS[i]),
        text(`stat-label-${i}`, "statLabel", stat.label, "#7e8aa6"),
      ],
    }),
  );

  const tagChips = CARD.tags.map((tag, i) =>
    styled(`chip-${i}`, { fill: "#141828", stroke: "#262c40", radius: 21 }, {
      display: "flex",
      padding: { left: 16, right: 16, top: 9, bottom: 9 },
      children: [text(`chip-text-${i}`, "tag", tag, "#a9b6d3")],
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
      text("title", "title", CARD.title, "url(#titleGrad)", {
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
        children: [text("badge-text", "badge", CARD.badge, "#93a0bd")],
      }),
      text("tagline", "tagline", CARD.tagline, "#a8b3cc", {
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
          text("repo", "tag", CARD.repo, "#66718c"),
        ],
      },
    ],
  });
}

const DEFS =
  `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="#101321"/><stop offset="1" stop-color="#1a2036"/>` +
  `</linearGradient>` +
  `<linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0">` +
  `<stop offset="0" stop-color="#8ab4ff"/><stop offset="1" stop-color="#c7a7ff"/>` +
  `</linearGradient>`;

function main() {
  const outPath = process.argv[2] ?? path.join(import.meta.dirname, "card.svg");
  const tree = buildCard();
  const t0 = performance.now();
  const result = solveLayout(tree);
  const ms = performance.now() - t0;
  const svg = renderToSvg(tree, result, {
    style: (node) => (node.id ? styles.get(node.id) : undefined),
    defs: DEFS,
  });
  fs.writeFileSync(outPath, svg + "\n");
  console.error(
    `Solved ${result.boxes.size} nodes in ${ms.toFixed(3)}ms → ${path.relative(process.cwd(), outPath)}`,
  );
}

main();
