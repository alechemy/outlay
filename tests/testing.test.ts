import { solveLayout } from "../src/solver";
import { hitTest, relativeTo } from "../src/helpers";
import {
  assertNoOverlaps,
  overflowsX,
  overflowsY,
  sweep,
} from "../src/testing";
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

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// relativeTo: nested child is offset from its parent's border-box origin
{
  const leaf: LayoutNode = { id: "leaf", width: 50, height: 50 };
  const panel: LayoutNode = {
    id: "panel",
    width: 200,
    height: 200,
    display: "flex",
    padding: 20,
    children: [leaf],
  };
  const tree: LayoutNode = {
    id: "root",
    width: 300,
    height: 300,
    display: "flex",
    padding: 10,
    children: [panel],
  };
  const result = solveLayout(tree);
  const leafBox = result.boxes.get("leaf")!;
  const panelBox = result.boxes.get("panel")!;
  const rel = relativeTo(result, "leaf");
  assert(
    rel.x === leafBox.x - panelBox.x && rel.y === leafBox.y - panelBox.y,
    "relativeTo offsets a nested child from its parent",
  );
  assert(rel.x > 0 && rel.y > 0, "nested child sits inside the parent's padding");
}

// relativeTo: the root reports its own position
{
  const tree: LayoutNode = { id: "root", width: 100, height: 100, children: [] };
  const result = solveLayout(tree);
  const rootBox = result.boxes.get("root")!;
  const rel = relativeTo(result, "root");
  assert(
    rel.x === rootBox.x && rel.y === rootBox.y,
    "relativeTo returns the root's own x/y",
  );
}

// relativeTo: unknown id throws
{
  const result = solveLayout({ id: "root", width: 100, height: 100, children: [] });
  assert(throws(() => relativeTo(result, "ghost")), "relativeTo throws on an unknown id");
}

// hitTest: deepest child wins; right/bottom edges are exclusive
{
  const child: LayoutNode = { id: "child", width: 40, height: 40 };
  const tree: LayoutNode = {
    id: "root",
    width: 100,
    height: 100,
    display: "flex",
    children: [child],
  };
  const result = solveLayout(tree);
  assert(hitTest(result, 20, 20)?.id === "child", "hitTest returns the deepest hit");
  assert(hitTest(result, 40, 20)?.id === "root", "right edge is exclusive: falls back to root");
  assert(hitTest(result, 20, 40)?.id === "root", "bottom edge is exclusive: falls back to root");
  assert(hitTest(result, 200, 200) === undefined, "hitTest returns undefined outside all boxes");
}

// hitTest: last-wins among equal-depth overlapping absolute siblings
{
  const abs1: LayoutNode = {
    id: "abs1",
    position: "absolute",
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  };
  const abs2: LayoutNode = {
    id: "abs2",
    position: "absolute",
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  };
  const tree: LayoutNode = {
    id: "root",
    width: 200,
    height: 200,
    children: [abs1, abs2],
  };
  const result = solveLayout(tree);
  assert(
    hitTest(result, 50, 50)?.id === "abs2",
    "hitTest last-wins among equal-depth overlapping siblings",
  );
}

// sweep: collects a failure at one width and passes at the others
{
  const build = (width: number): LayoutNode => ({
    id: "root",
    width,
    height: 100,
    display: "flex",
    children: [{ id: "fixed", width: 150, height: 50, flexShrink: 0 }],
  });
  const failures = sweep([120, 160, 200], build, (result) => {
    if (overflowsX(result, "root")) throw new Error("child overflows the root");
  });
  assert(failures.length === 1, "sweep collects exactly one failure");
  assert(failures[0]?.width === 120, "sweep reports the failing width");
  assert(failures[0]?.error instanceof Error, "sweep surfaces the thrown Error");
}

// assertNoOverlaps: a normal flex row does not overlap (sibling default and explicit ids)
{
  const tree: LayoutNode = {
    id: "root",
    width: 300,
    height: 100,
    display: "flex",
    children: [
      { id: "a", width: 100, height: 50 },
      { id: "b", width: 100, height: 50 },
    ],
  };
  const result = solveLayout(tree);
  assert(!throws(() => assertNoOverlaps(result)), "assertNoOverlaps passes on a normal row (siblings)");
  assert(
    !throws(() => assertNoOverlaps(result, ["a", "b"])),
    "assertNoOverlaps passes on a normal row (explicit ids)",
  );
}

// assertNoOverlaps: absolutely positioned overlapping siblings throw
{
  const tree: LayoutNode = {
    id: "root",
    width: 200,
    height: 200,
    children: [
      { id: "abs1", position: "absolute", left: 0, top: 0, width: 100, height: 100 },
      { id: "abs2", position: "absolute", left: 0, top: 0, width: 100, height: 100 },
    ],
  };
  const result = solveLayout(tree);
  assert(
    throws(() => assertNoOverlaps(result)),
    "assertNoOverlaps throws on overlapping absolute siblings",
  );
}

// overflowsX / overflowsY: a fixed child wider than its parent overflows; a fitting child does not
{
  const overflowing: LayoutNode = {
    id: "root",
    width: 100,
    height: 100,
    display: "flex",
    children: [{ id: "wide", width: 150, height: 50, flexShrink: 0 }],
  };
  const overflowResult = solveLayout(overflowing);
  assert(overflowsX(overflowResult, "root"), "overflowsX true when a child is wider than its parent");
  assert(!overflowsY(overflowResult, "root"), "overflowsY false when children fit vertically");

  const fitting: LayoutNode = {
    id: "root",
    width: 300,
    height: 100,
    display: "flex",
    children: [{ id: "narrow", width: 100, height: 50 }],
  };
  const fitResult = solveLayout(fitting);
  assert(!overflowsX(fitResult, "root"), "overflowsX false when the child fits");
}

console.log(`\n--- Testing/Helpers Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
