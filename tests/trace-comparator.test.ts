import { solveLayout } from "../src/solver";
import { compareTraces } from "../src/trace-comparator";
import {
  BoxSides,
  DebugTrace,
  ResolvedBox,
  ResolvedBoxModel,
} from "../src/types";

const ZERO_SIDES: BoxSides = { top: 0, right: 0, bottom: 0, left: 0 };

function makeBoxModel(
  overrides: Partial<ResolvedBoxModel> = {},
): ResolvedBoxModel {
  return {
    contentWidth: 0,
    contentHeight: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    borderTop: 0,
    borderRight: 0,
    borderBottom: 0,
    borderLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    ...overrides,
  };
}

function makeBox(
  id: string,
  overrides: Partial<ResolvedBox> = {},
): ResolvedBox {
  return {
    id,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    padding: { ...ZERO_SIDES },
    border: { ...ZERO_SIDES },
    margin: { ...ZERO_SIDES },
    borderBoxWidth: 0,
    borderBoxHeight: 0,
    outerWidth: 0,
    outerHeight: 0,
    ...overrides,
  };
}

function makeEmptyTrace(): DebugTrace {
  return {
    resolvedBoxModels: new Map(),
    flexItemOrder: [],
    hypotheticalMainSizes: new Map(),
    flexLines: [],
    resolvedMainSizes: new Map(),
    frozenItems: new Map(),
    resolvedCrossSizes: new Map(),
    boxes: new Map(),
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

// Test 1: Identical empty traces match
console.log("Test 1: Identical empty traces match");
{
  const a = makeEmptyTrace();
  const b = makeEmptyTrace();
  const result = compareTraces(a, b);
  assert(result.match === true, "should match");
  assert(result.firstDivergence === null, "no divergence");
  assert(result.allDivergences.length === 0, "no divergences");
}

// Test 2: Identical populated traces match
console.log("Test 2: Identical populated traces match");
{
  const a = makeEmptyTrace();
  a.resolvedBoxModels.set(
    "n1",
    makeBoxModel({ contentWidth: 100, contentHeight: 50 }),
  );
  a.flexItemOrder = ["n1"];
  a.hypotheticalMainSizes.set("n1", 120);
  a.flexLines = [{ itemIds: ["n1"], mainSize: 120 }];
  a.resolvedMainSizes.set("n1", 120);
  a.frozenItems.set("n1", "flexible");
  a.resolvedCrossSizes.set("n1", 50);
  a.boxes.set("n1", makeBox("n1", { width: 100, height: 50 }));

  const b = makeEmptyTrace();
  b.resolvedBoxModels.set(
    "n1",
    makeBoxModel({ contentWidth: 100, contentHeight: 50 }),
  );
  b.flexItemOrder = ["n1"];
  b.hypotheticalMainSizes.set("n1", 120);
  b.flexLines = [{ itemIds: ["n1"], mainSize: 120 }];
  b.resolvedMainSizes.set("n1", 120);
  b.frozenItems.set("n1", "flexible");
  b.resolvedCrossSizes.set("n1", 50);
  b.boxes.set("n1", makeBox("n1", { width: 100, height: 50 }));

  const result = compareTraces(a, b);
  assert(result.match === true, "should match");
}

// Test 3: Divergence in resolveBoxModel is detected
console.log("Test 3: Divergence in resolveBoxModel");
{
  const a = makeEmptyTrace();
  a.resolvedBoxModels.set("n1", makeBoxModel({ contentWidth: 100 }));

  const b = makeEmptyTrace();
  b.resolvedBoxModels.set("n1", makeBoxModel({ contentWidth: 200 }));

  const result = compareTraces(a, b);
  assert(result.match === false, "should not match");
  assert(
    result.firstDivergence!.stage === "resolveBoxModel",
    "stage is resolveBoxModel",
  );
  assert(result.firstDivergence!.nodeId === "n1", "nodeId is n1");
  assert(
    result.firstDivergence!.property === "contentWidth",
    "property is contentWidth",
  );
}

// Test 4: Divergence in flexItemOrder
console.log("Test 4: Divergence in flexItemOrder");
{
  const a = makeEmptyTrace();
  a.flexItemOrder = ["a", "b", "c"];

  const b = makeEmptyTrace();
  b.flexItemOrder = ["a", "c", "b"];

  const result = compareTraces(a, b);
  assert(result.match === false, "should not match");
  assert(
    result.firstDivergence!.stage === "collectFlexItems",
    "stage is collectFlexItems",
  );
}

// Test 5: Divergence in hypotheticalMainSizes
console.log("Test 5: Divergence in hypotheticalMainSizes");
{
  const a = makeEmptyTrace();
  a.hypotheticalMainSizes.set("n1", 100);

  const b = makeEmptyTrace();
  b.hypotheticalMainSizes.set("n1", 105);

  const result = compareTraces(a, b);
  assert(result.match === false, "should not match");
  assert(
    result.firstDivergence!.stage === "determineMainSize",
    "stage is determineMainSize",
  );
}

// Test 6: Values within tolerance are considered matching
console.log("Test 6: Values within tolerance match");
{
  const a = makeEmptyTrace();
  a.resolvedBoxModels.set("n1", makeBoxModel({ contentWidth: 100 }));

  const b = makeEmptyTrace();
  b.resolvedBoxModels.set("n1", makeBoxModel({ contentWidth: 100.3 }));

  const result = compareTraces(a, b, 0.5);
  assert(result.match === true, "should match within tolerance");
}

// Test 7: Divergence in flexLines
console.log("Test 7: Divergence in flexLines");
{
  const a = makeEmptyTrace();
  a.flexLines = [{ itemIds: ["a", "b"], mainSize: 200 }];

  const b = makeEmptyTrace();
  b.flexLines = [{ itemIds: ["a", "b"], mainSize: 300 }];

  const result = compareTraces(a, b);
  assert(result.match === false, "should not match");
  assert(
    result.firstDivergence!.stage === "collectIntoLines",
    "stage is collectIntoLines",
  );
}

// Test 8: Divergence in frozenItems
console.log("Test 8: Divergence in frozenItems");
{
  const a = makeEmptyTrace();
  a.frozenItems.set("n1", "min-clamped");

  const b = makeEmptyTrace();
  b.frozenItems.set("n1", "flexible");

  const result = compareTraces(a, b);
  assert(result.match === false, "should not match");
  assert(
    result.firstDivergence!.stage === "resolveFlexibleLengths",
    "stage is resolveFlexibleLengths",
  );
}

// Test 9: Divergence in final boxes
console.log("Test 9: Divergence in final boxes");
{
  const a = makeEmptyTrace();
  a.boxes.set("n1", makeBox("n1", { x: 10, y: 20 }));

  const b = makeEmptyTrace();
  b.boxes.set("n1", makeBox("n1", { x: 10, y: 30 }));

  const result = compareTraces(a, b);
  assert(result.match === false, "should not match");
  assert(result.firstDivergence!.stage === "finalBoxes", "stage is finalBoxes");
  assert(result.firstDivergence!.property === "y", "property is y");
}

// Test 10: Missing node in actual trace
console.log("Test 10: Missing node in actual trace");
{
  const a = makeEmptyTrace();
  a.resolvedBoxModels.set("n1", makeBoxModel({ contentWidth: 100 }));
  a.resolvedBoxModels.set("n2", makeBoxModel({ contentWidth: 200 }));

  const b = makeEmptyTrace();
  b.resolvedBoxModels.set("n1", makeBoxModel({ contentWidth: 100 }));

  const result = compareTraces(a, b);
  assert(result.match === false, "should not match");
  assert(result.firstDivergence!.nodeId === "n2", "missing node is n2");
}

// Test 11: solveLayout with debug=true returns a trace
console.log("Test 11: solveLayout with debug=true returns trace");
{
  const result = solveLayout(
    {
      id: "root",
      width: 200,
      height: 100,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 1, right: 1, bottom: 1, left: 1 },
      boxSizing: "border-box",
      display: "flex",
      children: [
        {
          id: "child-1",
          width: 50,
          height: 30,
          padding: { top: 5, right: 5, bottom: 5, left: 5 },
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          border: { top: 0, right: 0, bottom: 0, left: 0 },
          boxSizing: "content-box",
          display: "block",
          children: [],
        },
      ],
    },
    { debug: true },
  );

  assert(result.trace !== undefined, "trace exists");
  assert(result.trace!.resolvedBoxModels.size === 2, "2 box models resolved");
  assert(result.trace!.resolvedBoxModels.has("root"), "root box model exists");
  assert(
    result.trace!.resolvedBoxModels.has("child-1"),
    "child box model exists",
  );

  const rootModel = result.trace!.resolvedBoxModels.get("root")!;
  // border-box: 200 - 10 - 10 - 1 - 1 = 178
  assert(
    rootModel.contentWidth === 178,
    `root contentWidth is 178 (got ${rootModel.contentWidth})`,
  );
  // border-box: 100 - 10 - 10 - 1 - 1 = 78
  assert(
    rootModel.contentHeight === 78,
    `root contentHeight is 78 (got ${rootModel.contentHeight})`,
  );

  assert(result.trace!.flexItemOrder.length === 1, "1 flex item");
  assert(result.trace!.flexItemOrder[0] === "child-1", "flex item is child-1");
  assert(
    result.trace!.hypotheticalMainSizes.has("child-1"),
    "hypothetical main size exists",
  );
  // content-box child: 50 + 5 + 5 = 60 (no border)
  assert(
    result.trace!.hypotheticalMainSizes.get("child-1") === 60,
    `hypothetical main size is 60 (got ${result.trace!.hypotheticalMainSizes.get("child-1")})`,
  );
}

// Test 12: solveLayout with debug=false (default) returns no trace
console.log("Test 12: solveLayout without debug returns no trace");
{
  const result = solveLayout({
    id: "root",
    width: 100,
    height: 100,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    border: { top: 0, right: 0, bottom: 0, left: 0 },
    boxSizing: "content-box",
    display: "block",
    children: [],
  });

  assert(result.trace === undefined, "no trace without debug option");
}

// Test 13: allDivergences collects multiple divergences across stages
console.log("Test 13: Multiple divergences are collected");
{
  const a = makeEmptyTrace();
  a.resolvedBoxModels.set("n1", makeBoxModel({ contentWidth: 100 }));
  a.hypotheticalMainSizes.set("n1", 100);
  a.boxes.set("n1", makeBox("n1", { x: 10 }));

  const b = makeEmptyTrace();
  b.resolvedBoxModels.set("n1", makeBoxModel({ contentWidth: 200 }));
  b.hypotheticalMainSizes.set("n1", 200);
  b.boxes.set("n1", makeBox("n1", { x: 20 }));

  const result = compareTraces(a, b);
  assert(result.match === false, "should not match");
  assert(
    result.allDivergences.length === 3,
    `3 divergences found (got ${result.allDivergences.length})`,
  );
  assert(
    result.firstDivergence!.stage === "resolveBoxModel",
    "first divergence is earliest stage",
  );
}

// Summary
console.log(`\n--- Trace Comparator Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
