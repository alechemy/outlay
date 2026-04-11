/**
 * benchmark.ts
 *
 * Measures solver performance at 100 / 1,000 / 10,000 nodes.
 *
 * Targets (from PROJECT.md):
 *   100  nodes, 2 levels deep  →  < 1ms   (animation frame budget)
 *   1,000 nodes, 3 levels deep  →  < 5ms   (drag operation budget)
 *   10,000 nodes, 5 levels deep  →  < 50ms  (design tool / SSR budget)
 *
 * Usage:
 *   npm run bench
 *   npm run bench -- --runs 200
 */

import { solveLayout } from "../src/solver";
import { LayoutNode } from "../src/types";

// ── Tree generation ──────────────────────────────────────────────────────────

let _idSeq = 0;
function nextId() {
  return _idSeq === 0 ? "root-node" : `n-${_idSeq++}`;
}

function mkNode(
  width: number,
  height: number,
  children: LayoutNode[] = [],
): LayoutNode {
  const id = _idSeq === 0 ? ((_idSeq++), "root-node") : `n-${_idSeq++}`;
  return {
    id,
    width,
    height,
    padding: { top: 4, right: 4, bottom: 4, left: 4 },
    margin: { top: 2, right: 2, bottom: 2, left: 2 },
    border: { top: 1, right: 1, bottom: 1, left: 1 },
    boxSizing: "border-box",
    display: children.length > 0 ? "flex" : "block",
    flexDirection: "row",
    flexWrap: "nowrap",
    flexGrow: 1,
    flexShrink: 1,
    children,
  };
}

/**
 * Build a flat 2-level tree: root → N leaf children.
 * Total nodes = N + 1.
 */
function buildFlat(leafCount: number): LayoutNode {
  _idSeq = 0;
  const root: LayoutNode = {
    id: "root-node",
    width: 1200,
    height: 800,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    border: { top: 0, right: 0, bottom: 0, left: 0 },
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "row",
    flexWrap: "nowrap",
    children: [],
  };
  _idSeq = 1;
  for (let i = 0; i < leafCount; i++) {
    root.children.push({
      id: `n-${_idSeq++}`,
      width: undefined,
      height: 40,
      padding: { top: 2, right: 4, bottom: 2, left: 4 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      boxSizing: "border-box",
      display: "block",
      flexGrow: 1,
      flexShrink: 1,
      children: [],
    });
  }
  return root;
}

/**
 * Build a balanced tree: root → (branching) children → ... → leaves.
 * Stops when node count >= targetCount.
 */
function buildBalanced(targetCount: number, branching: number): LayoutNode {
  _idSeq = 0;

  function build(depth: number, maxDepth: number): LayoutNode {
    const id = _idSeq === 0 ? ((_idSeq++), "root-node") : `n-${_idSeq++}`;
    if (depth >= maxDepth) {
      return {
        id,
        width: 80,
        height: 40,
        padding: { top: 2, right: 4, bottom: 2, left: 4 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        border: { top: 0, right: 0, bottom: 0, left: 0 },
        boxSizing: "border-box",
        display: "block",
        flexGrow: 1,
        flexShrink: 1,
        children: [],
      };
    }
    const children: LayoutNode[] = [];
    for (let i = 0; i < branching; i++) {
      children.push(build(depth + 1, maxDepth));
    }
    return {
      id,
      width: depth === 0 ? 1200 : undefined,
      height: depth === 0 ? 800 : undefined,
      padding: { top: 4, right: 4, bottom: 4, left: 4 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 1, right: 1, bottom: 1, left: 1 },
      boxSizing: "border-box",
      display: "flex",
      flexDirection: depth % 2 === 0 ? "row" : "column",
      flexWrap: "nowrap",
      flexGrow: 1,
      flexShrink: 1,
      children,
    };
  }

  _idSeq = 0;
  // maxDepth = number of levels below root
  const maxDepth = targetCount <= 200 ? 2 : targetCount <= 2000 ? 3 : 5;
  const tree = build(0, maxDepth);
  return tree;
}

function countNodes(node: LayoutNode): number {
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
}

// ── Benchmark harness ────────────────────────────────────────────────────────

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

function p95(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)]!;
}

function bench(
  label: string,
  tree: LayoutNode,
  runs: number,
  target: number,
): void {
  const nodeCount = countNodes(tree);

  // Warm up
  for (let i = 0; i < 5; i++) solveLayout(tree);

  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    solveLayout(tree);
    times.push(performance.now() - t0);
  }

  const med = median(times);
  const p = p95(times);
  const pass = med <= target;

  const status = pass ? "✅" : "❌";
  console.log(
    `${status} ${label.padEnd(28)} nodes: ${String(nodeCount).padStart(6)}  ` +
      `median: ${med.toFixed(2).padStart(7)}ms  ` +
      `p95: ${p.toFixed(2).padStart(7)}ms  ` +
      `target: <${target}ms`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const runsIdx = args.indexOf("--runs");
  const runs = runsIdx !== -1 ? parseInt(args[runsIdx + 1]!, 10) : 100;

  console.log(`\nBenchmark — ${runs} runs each\n`);

  // ~100 nodes, 2 levels
  bench("flat (2 levels)", buildFlat(99), runs, 1);

  // ~1,000 nodes, 3 levels (branching 10: 1+10+100+1000 = 1111)
  bench("balanced-3 (3 levels)", buildBalanced(1000, 10), runs, 5);

  // ~10,000 nodes, 5 levels (branching 6: 1+6+36+216+1296+7776 = 9331)
  bench("balanced-5 (5 levels)", buildBalanced(10000, 6), runs, 50);

  console.log();
}

main();
