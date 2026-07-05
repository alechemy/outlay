/**
 * Server-side layout preview.
 *
 * Reads a LayoutNode tree from JSON, solves it with `solveLayout` — no browser,
 * no DOM, no canvas — and writes an SVG of the resolved boxes. This is the
 * "layout without a browser" pitch for SSR, design tooling, and tests.
 *
 *   npx tsx pages/demos/server-layout/generate.ts [input.json] [output.svg]
 *
 * Defaults to example-input.json / example-output.svg next to this script.
 */

import * as fs from "fs";
import * as path from "path";
import { solveLayout } from "../../../src/solver";
import type { LayoutNode, ResolvedBox } from "../../../src/types";

const PAD = 24;
const FILL = [
  "#e8d5c4", "#c4d4e0", "#d4e0c4", "#e0d4c4",
  "#c4d8d4", "#dcc4e0", "#e0c4c4", "#c4c8e0",
];
const STROKE = "rgba(32,27,24,0.28)";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Walked {
  id: string;
  depth: number;
}

function walk(node: LayoutNode, depth: number, out: Walked[]): void {
  out.push({ id: node.id, depth });
  for (const c of node.children ?? []) walk(c, depth + 1, out);
}

function toSvg(tree: LayoutNode, boxes: Map<string, ResolvedBox>): string {
  const root = boxes.get(tree.id)!;
  const order: Walked[] = [];
  walk(tree, 0, order);

  const W = root.borderBoxWidth + PAD * 2;
  const H = root.borderBoxHeight + PAD * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
  );
  parts.push(`<rect width="${W}" height="${H}" rx="14" fill="#f5f1ea"/>`);

  for (const { id, depth } of order) {
    const b = boxes.get(id);
    if (!b) continue;
    const x = +(b.x - root.x + PAD).toFixed(2);
    const y = +(b.y - root.y + PAD).toFixed(2);
    const w = +b.borderBoxWidth.toFixed(2);
    const h = +b.borderBoxHeight.toFixed(2);
    const fill = depth === 0 ? "#fffdf8" : FILL[(depth - 1) % FILL.length];
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ` +
        `fill="${fill}" stroke="${STROKE}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${x + 6}" y="${y + 14}" font-size="10" fill="rgba(32,27,24,0.7)">${esc(id)}</text>`,
    );
    if (w > 70 && h > 30) {
      parts.push(
        `<text x="${x + w - 6}" y="${y + h - 6}" font-size="9" text-anchor="end" ` +
          `fill="rgba(32,27,24,0.45)">${Math.round(b.width)}×${Math.round(b.height)}</text>`,
      );
    }
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function main() {
  const scriptDir = import.meta.dirname;
  const inPath = process.argv[2] ?? path.join(scriptDir, "example-input.json");
  const outPath = process.argv[3] ?? path.join(scriptDir, "example-output.svg");

  const tree = JSON.parse(fs.readFileSync(inPath, "utf8")) as LayoutNode;
  const t0 = performance.now();
  const { boxes } = solveLayout(tree);
  const ms = performance.now() - t0;

  const svg = toSvg(tree, boxes);
  fs.writeFileSync(outPath, svg + "\n");

  console.error(
    `Solved ${boxes.size} nodes in ${ms.toFixed(3)}ms → ${path.relative(process.cwd(), outPath)}`,
  );
}

main();
