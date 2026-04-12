import { DebugTrace, ResolvedBox, ResolvedBoxModel } from "../src/types";

export interface Divergence {
  stage: string;
  nodeId?: string;
  property?: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

export interface TraceComparisonResult {
  match: boolean;
  firstDivergence: Divergence | null;
  allDivergences: Divergence[];
}

function compareNumber(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function compareBoxModel(
  stage: string,
  nodeId: string,
  expected: ResolvedBoxModel,
  actual: ResolvedBoxModel,
  tolerance: number,
  divergences: Divergence[],
): void {
  const props: (keyof ResolvedBoxModel)[] = [
    "contentWidth",
    "contentHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTop",
    "borderRight",
    "borderBottom",
    "borderLeft",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
  ];

  for (const prop of props) {
    if (!compareNumber(expected[prop], actual[prop], tolerance)) {
      divergences.push({
        stage,
        nodeId,
        property: prop,
        expected: expected[prop],
        actual: actual[prop],
        message: `[${nodeId}] ${prop}: expected ${expected[prop]}, got ${actual[prop]} (diff: ${Math.abs(expected[prop] - actual[prop]).toFixed(4)})`,
      });
    }
  }
}

function compareResolvedBox(
  stage: string,
  nodeId: string,
  expected: ResolvedBox,
  actual: ResolvedBox,
  tolerance: number,
  divergences: Divergence[],
): void {
  const numericProps: (keyof ResolvedBox)[] = [
    "x",
    "y",
    "width",
    "height",
    "borderBoxWidth",
    "borderBoxHeight",
    "outerWidth",
    "outerHeight",
  ];

  for (const prop of numericProps) {
    const ev = expected[prop] as number;
    const av = actual[prop] as number;
    if (!compareNumber(ev, av, tolerance)) {
      divergences.push({
        stage,
        nodeId,
        property: prop,
        expected: ev,
        actual: av,
        message: `[${nodeId}] ${prop}: expected ${ev}, got ${av} (diff: ${Math.abs(ev - av).toFixed(4)})`,
      });
    }
  }

  const sideProps = ["padding", "border", "margin"] as const;
  const sides = ["top", "right", "bottom", "left"] as const;
  for (const prop of sideProps) {
    for (const side of sides) {
      const ev = expected[prop][side];
      const av = actual[prop][side];
      if (!compareNumber(ev, av, tolerance)) {
        divergences.push({
          stage,
          nodeId,
          property: `${prop}.${side}`,
          expected: ev,
          actual: av,
          message: `[${nodeId}] ${prop}.${side}: expected ${ev}, got ${av} (diff: ${Math.abs(ev - av).toFixed(4)})`,
        });
      }
    }
  }
}

function compareNumericMap(
  stage: string,
  property: string,
  expected: Map<string, number>,
  actual: Map<string, number>,
  tolerance: number,
  divergences: Divergence[],
): void {
  for (const [id, ev] of expected) {
    const av = actual.get(id);
    if (av === undefined) {
      divergences.push({
        stage,
        nodeId: id,
        property,
        expected: ev,
        actual: undefined,
        message: `[${id}] ${property}: missing in actual trace`,
      });
    } else if (!compareNumber(ev, av, tolerance)) {
      divergences.push({
        stage,
        nodeId: id,
        property,
        expected: ev,
        actual: av,
        message: `[${id}] ${property}: expected ${ev}, got ${av} (diff: ${Math.abs(ev - av).toFixed(4)})`,
      });
    }
  }
  for (const [id] of actual) {
    if (!expected.has(id)) {
      divergences.push({
        stage,
        nodeId: id,
        property,
        expected: undefined,
        actual: actual.get(id),
        message: `[${id}] ${property}: unexpected entry in actual trace`,
      });
    }
  }
}

export function compareTraces(
  expected: DebugTrace,
  actual: DebugTrace,
  tolerance = 0.5,
): TraceComparisonResult {
  const allDivergences: Divergence[] = [];

  // Stage 1: resolvedBoxModels
  const stage1 = "resolveBoxModel";
  for (const [id, expectedModel] of expected.resolvedBoxModels) {
    const actualModel = actual.resolvedBoxModels.get(id);
    if (!actualModel) {
      allDivergences.push({
        stage: stage1,
        nodeId: id,
        expected: expectedModel,
        actual: undefined,
        message: `[${id}] missing in actual resolvedBoxModels`,
      });
    } else {
      compareBoxModel(
        stage1,
        id,
        expectedModel,
        actualModel,
        tolerance,
        allDivergences,
      );
    }
  }
  for (const [id] of actual.resolvedBoxModels) {
    if (!expected.resolvedBoxModels.has(id)) {
      allDivergences.push({
        stage: stage1,
        nodeId: id,
        expected: undefined,
        actual: actual.resolvedBoxModels.get(id),
        message: `[${id}] unexpected in actual resolvedBoxModels`,
      });
    }
  }

  // Stage 2: flexItemOrder
  const stage2 = "collectFlexItems";
  if (expected.flexItemOrder.length !== actual.flexItemOrder.length) {
    allDivergences.push({
      stage: stage2,
      expected: expected.flexItemOrder,
      actual: actual.flexItemOrder,
      message: `flexItemOrder length: expected ${expected.flexItemOrder.length}, got ${actual.flexItemOrder.length}`,
    });
  } else {
    for (let i = 0; i < expected.flexItemOrder.length; i++) {
      if (expected.flexItemOrder[i] !== actual.flexItemOrder[i]) {
        allDivergences.push({
          stage: stage2,
          property: `index ${i}`,
          expected: expected.flexItemOrder[i],
          actual: actual.flexItemOrder[i],
          message: `flexItemOrder[${i}]: expected "${expected.flexItemOrder[i]}", got "${actual.flexItemOrder[i]}"`,
        });
      }
    }
  }

  // Stage 3: hypotheticalMainSizes
  compareNumericMap(
    "determineMainSize",
    "hypotheticalMainSize",
    expected.hypotheticalMainSizes,
    actual.hypotheticalMainSizes,
    tolerance,
    allDivergences,
  );

  // Stage 4: flexLines
  const stage4 = "collectIntoLines";
  if (expected.flexLines.length !== actual.flexLines.length) {
    allDivergences.push({
      stage: stage4,
      expected: expected.flexLines.length,
      actual: actual.flexLines.length,
      message: `flexLines count: expected ${expected.flexLines.length}, got ${actual.flexLines.length}`,
    });
  } else {
    for (let i = 0; i < expected.flexLines.length; i++) {
      const eLine = expected.flexLines[i];
      const aLine = actual.flexLines[i];
      if (eLine.itemIds.join(",") !== aLine.itemIds.join(",")) {
        allDivergences.push({
          stage: stage4,
          property: `line[${i}].itemIds`,
          expected: eLine.itemIds,
          actual: aLine.itemIds,
          message: `flexLines[${i}].itemIds: expected [${eLine.itemIds}], got [${aLine.itemIds}]`,
        });
      }
      if (!compareNumber(eLine.mainSize, aLine.mainSize, tolerance)) {
        allDivergences.push({
          stage: stage4,
          property: `line[${i}].mainSize`,
          expected: eLine.mainSize,
          actual: aLine.mainSize,
          message: `flexLines[${i}].mainSize: expected ${eLine.mainSize}, got ${aLine.mainSize}`,
        });
      }
    }
  }

  // Stage 5: resolvedMainSizes
  compareNumericMap(
    "resolveFlexibleLengths",
    "resolvedMainSize",
    expected.resolvedMainSizes,
    actual.resolvedMainSizes,
    tolerance,
    allDivergences,
  );

  // Stage 5b: frozenItems
  const stage5b = "resolveFlexibleLengths";
  for (const [id, ev] of expected.frozenItems) {
    const av = actual.frozenItems.get(id);
    if (av !== ev) {
      allDivergences.push({
        stage: stage5b,
        nodeId: id,
        property: "frozenState",
        expected: ev,
        actual: av,
        message: `[${id}] frozenState: expected "${ev}", got "${av}"`,
      });
    }
  }

  // Stage 6: resolvedCrossSizes
  compareNumericMap(
    "resolveCrossSize",
    "resolvedCrossSize",
    expected.resolvedCrossSizes,
    actual.resolvedCrossSizes,
    tolerance,
    allDivergences,
  );

  // Stage 7: final boxes
  const stage7 = "finalBoxes";
  for (const [id, expectedBox] of expected.boxes) {
    const actualBox = actual.boxes.get(id);
    if (!actualBox) {
      allDivergences.push({
        stage: stage7,
        nodeId: id,
        expected: expectedBox,
        actual: undefined,
        message: `[${id}] missing in actual boxes`,
      });
    } else {
      compareResolvedBox(
        stage7,
        id,
        expectedBox,
        actualBox,
        tolerance,
        allDivergences,
      );
    }
  }

  return {
    match: allDivergences.length === 0,
    firstDivergence: allDivergences[0] ?? null,
    allDivergences,
  };
}
