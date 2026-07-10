/**
 * Server-side layout preview.
 *
 * Reads a LayoutNode tree from JSON, solves it with `solveLayout` — no browser,
 * no DOM, no canvas — and writes an SVG of the resolved boxes via the
 * `outlay/svg` debug renderer, with grid track outlines from the debug trace.
 *
 *   npx tsx pages/demos/server-layout/generate.ts [input.json] [output.svg]
 *
 * Defaults to example-input.json / example-output.svg next to this script.
 */

import * as fs from "fs";
import * as path from "path";
import { solveLayout } from "../../../src/solver";
import { renderDebugSvg } from "../../../src/svg";
import type { LayoutNode } from "../../../src/types";

function main() {
  const scriptDir = import.meta.dirname;
  const inPath = process.argv[2] ?? path.join(scriptDir, "example-input.json");
  const outPath = process.argv[3] ?? path.join(scriptDir, "example-output.svg");

  const tree = JSON.parse(fs.readFileSync(inPath, "utf8")) as LayoutNode;
  const t0 = performance.now();
  const result = solveLayout(tree, { debug: true });
  const ms = performance.now() - t0;

  const svg = renderDebugSvg(tree, result, { trace: result.trace });
  fs.writeFileSync(outPath, svg + "\n");

  console.error(
    `Solved ${result.boxes.size} nodes in ${ms.toFixed(3)}ms → ${path.relative(process.cwd(), outPath)}`,
  );
}

main();
