import { solveLayout } from "../src/solver";
import type { LayoutNode } from "../src/types";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

// Ids are optional: anonymous nodes solve and get auto ids
{
  const tree: LayoutNode = {
    width: 400,
    height: 200,
    children: [{ width: 100 }, { flexGrow: 1 }],
  };
  const { boxes, nodes } = solveLayout(tree);
  assert(boxes.size === 3, "anonymous tree produces a box per node");
  const rootBox = nodes.get(tree);
  assert(rootBox !== undefined && rootBox.width === 400, "root reachable by reference");
  const second = nodes.get(tree.children![1]);
  assert(second !== undefined && second.width === 300, "flexed child reachable by reference");
  assert(second !== undefined && second.x === 100, "flexed child positioned after sibling");
}

// nodes map and boxes map hold the same objects
{
  const child: LayoutNode = { id: "kid", width: 50, height: 40 };
  const tree: LayoutNode = { id: "root", width: 200, height: 100, children: [child] };
  const { boxes, nodes } = solveLayout(tree);
  assert(nodes.get(child) === boxes.get("kid"), "by-reference and by-id lookups agree");
}

// Auto ids never collide with caller-provided ids
{
  const tree: LayoutNode = {
    id: "auto-1",
    width: 300,
    height: 100,
    children: [{ width: 60 }, { id: "auto-2", width: 60 }, { width: 60 }],
  };
  const { boxes, nodes } = solveLayout(tree);
  assert(boxes.size === 4, "all nodes emitted despite auto-N ids being taken");
  const anon1 = nodes.get(tree.children![0]);
  const anon3 = nodes.get(tree.children![2]);
  assert(
    anon1 !== undefined && anon3 !== undefined && anon1 !== anon3,
    "anonymous siblings get distinct boxes",
  );
  assert(anon3 !== undefined && anon3.x === 120, "third child positioned correctly");
}

// display:none nodes get no box and no nodes entry
{
  const hidden: LayoutNode = { display: "none", width: 50 };
  const tree: LayoutNode = { width: 200, height: 100, children: [hidden] };
  const { nodes } = solveLayout(tree);
  assert(nodes.get(hidden) === undefined, "display:none node absent from nodes map");
}

// parentId: explicit and auto ids, root undefined
{
  const child: LayoutNode = { id: "kid", width: 50, height: 40 };
  const tree: LayoutNode = { id: "root", width: 200, height: 100, children: [child] };
  const { boxes, nodes } = solveLayout(tree);
  assert(nodes.get(child)!.parentId === "root", "child reports explicit parent id");
  assert(boxes.get("root")!.parentId === undefined, "root box has no parentId");
}
{
  const child: LayoutNode = { width: 50, height: 40 };
  const tree: LayoutNode = { width: 200, height: 100, children: [child] };
  const { nodes } = solveLayout(tree);
  const rootBox = nodes.get(tree)!;
  const childBox = nodes.get(child)!;
  assert(childBox.parentId === rootBox.id, "child reports auto-assigned parent id");
}

// parentId: absolutely positioned child still reports its tree parent
{
  const abs: LayoutNode = {
    id: "abs",
    position: "absolute",
    left: 350,
    width: 100,
    height: 20,
  };
  const tree: LayoutNode = { id: "root", width: 400, height: 200, children: [abs] };
  const { nodes } = solveLayout(tree);
  assert(nodes.get(abs)!.parentId === "root", "absolute child reports tree parent");
}

// contentSize: in-flow union extent
{
  const tree: LayoutNode = {
    width: 400,
    height: 200,
    children: [{ width: 100, height: 50 }, { flexGrow: 1, height: 50 }],
  };
  const { contentSize } = solveLayout(tree);
  assert(contentSize.width === 400, "contentSize width equals root width");
  assert(contentSize.height === 200, "contentSize height equals root height");
}

// contentSize: absolute child expands the extent past the root
{
  const abs: LayoutNode = {
    position: "absolute",
    left: 350,
    width: 100,
    height: 20,
  };
  const tree: LayoutNode = { width: 400, height: 200, children: [abs] };
  const { contentSize } = solveLayout(tree);
  assert(contentSize.width === 450, "contentSize width includes absolute overflow");
}

// baseline: empty leaf synthesizes the baseline at its bottom border edge
{
  const leaf: LayoutNode = { id: "leaf", width: 60, height: 40 };
  const tree: LayoutNode = { id: "root", width: 200, height: 100, children: [leaf] };
  const { boxes } = solveLayout(tree);
  assert(boxes.get("leaf")!.baseline === 40, "empty leaf baseline is border-box height");
}

// gridLayouts: trace records per-container track sizing
{
  const tree: LayoutNode = {
    id: "grid",
    display: "grid",
    width: 300,
    height: 100,
    gridTemplateColumns: [100, 200],
    children: [{ width: 10, height: 10 }, { width: 10, height: 10 }],
  };
  const { trace } = solveLayout(tree, { debug: true });
  const info = trace!.gridLayouts!.get("grid");
  assert(
    info !== undefined &&
      info.colSizes.length === 2 &&
      info.colSizes[0] === 100 &&
      info.colSizes[1] === 200,
    "gridLayouts colSizes match the template",
  );
}

console.log(`\n--- API Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
