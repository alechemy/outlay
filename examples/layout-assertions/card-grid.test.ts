import { describe, expect, test } from "vitest";
import { solveLayout } from "../../dist/index.js";
import type { LayoutNode, LayoutResult } from "../../dist/index.js";
import {
  assertContained,
  assertNoOverlaps,
  boxOf,
  overflowsX,
  range,
  sweep,
} from "./helpers.js";
import { measureText } from "./text-metrics.js";

const PAGE_PAD = 16;
const GRID_GAP = 16;
const MIN_COL = 220;
const CARD_COUNT = 12;

const TITLES = [
  "Synchronous",
  "Zero WASM",
  "Node Safe",
  "Responsive",
  "Fast Sweeps",
  "No Browser",
  "Type Safe",
  "Composable",
  "Off DOM",
  "Assertions",
  "Deterministic",
  "Solve",
];
const BODIES = [
  "Solve flexbox and grid layout synchronously in plain JavaScript",
  "Assert that cards never overlap across every responsive width",
  "Measure text with precomputed advances so tests run without a browser",
];

function button(id: string, label: string): LayoutNode {
  return {
    id,
    display: "flex",
    padding: { top: 6, right: 14, bottom: 6, left: 14 },
    flexShrink: 0,
    children: [{ id: `${id}-label`, measureContent: measureText(label) }],
  };
}

function buildCardGrid(width: number): LayoutNode {
  const cards: LayoutNode[] = [];
  for (let i = 0; i < CARD_COUNT; i++) {
    cards.push({
      id: `card-${i}`,
      display: "flex",
      flexDirection: "column",
      padding: 12,
      gap: 6,
      children: [
        { id: `card-${i}-title`, measureContent: measureText(TITLES[i % TITLES.length]) },
        { id: `card-${i}-body`, measureContent: measureText(BODIES[i % BODIES.length]) },
      ],
    });
  }
  return {
    id: "page",
    display: "flex",
    flexDirection: "column",
    width,
    padding: PAGE_PAD,
    gap: 24,
    children: [
      {
        id: "header",
        display: "flex",
        alignItems: "center",
        gap: 12,
        children: [
          { id: "title", measureContent: measureText("Component Layout Tests") },
          { id: "header-spacer", flexGrow: 1 },
          button("header-cta", "Sign in"),
        ],
      },
      {
        id: "grid",
        display: "grid",
        gap: GRID_GAP,
        gridTemplateColumns: [
          { repeat: "auto-fill", tracks: [{ min: MIN_COL, max: "1fr" }] },
        ],
        children: cards,
      },
      {
        id: "footer",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: 8,
        children: [
          button("footer-back", "Back"),
          button("footer-reset", "Reset"),
          button("footer-continue", "Continue"),
        ],
      },
    ],
  };
}

const cardIds = Array.from({ length: CARD_COUNT }, (_, i) => `card-${i}`);
const footerIds = ["footer-back", "footer-reset", "footer-continue"];
const widths = range(320, 1280, 20);

/** auto-fill column count for repeat(auto-fill, minmax(MIN_COL, 1fr)) at a grid content width. */
function expectedColumns(width: number): number {
  const gridContentWidth = width - 2 * PAGE_PAD;
  return Math.max(1, Math.floor((gridContentWidth + GRID_GAP) / (MIN_COL + GRID_GAP)));
}

function topRowCount(result: LayoutResult): number {
  const topY = Math.min(...cardIds.map((id) => boxOf(result, id).y));
  return cardIds.filter((id) => Math.abs(boxOf(result, id).y - topY) < 0.5).length;
}

describe("responsive card grid", () => {
  test("no card overlaps at any width in the sweep", () => {
    const failures = sweep(widths, buildCardGrid, (result) =>
      assertNoOverlaps(result, cardIds),
    );
    expect(failures).toEqual([]);
  });

  test("no horizontal overflow at any width in the sweep", () => {
    const failures = sweep(widths, buildCardGrid, (result) => {
      if (overflowsX(result, "page")) {
        throw new Error("a box crosses the page content box horizontally");
      }
    });
    expect(failures).toEqual([]);
  });

  test("every card stays inside the grid content box", () => {
    const failures = sweep(widths, buildCardGrid, (result) =>
      assertContained(result, "grid", cardIds),
    );
    expect(failures).toEqual([]);
  });

  test("the CTA row never wraps above 360px", () => {
    const failures = sweep(
      widths.filter((w) => w > 360),
      buildCardGrid,
      (result) => {
        const tops = new Set(footerIds.map((id) => Math.round(boxOf(result, id).y)));
        if (tops.size > 1) throw new Error("footer buttons wrapped onto multiple rows");
      },
    );
    expect(failures).toEqual([]);
  });

  test("column count follows the minmax breakpoints", () => {
    for (const width of widths) {
      const result = solveLayout(buildCardGrid(width));
      expect(topRowCount(result), `at width ${width}`).toBe(expectedColumns(width));
    }
  });

  test("solves the whole responsive sweep in a few milliseconds", () => {
    const invariant = (result: LayoutResult) => {
      assertNoOverlaps(result, cardIds);
      if (overflowsX(result, "page")) throw new Error("overflow");
    };
    sweep(widths, buildCardGrid, invariant);
    const start = performance.now();
    const failures = sweep(widths, buildCardGrid, invariant);
    const elapsed = performance.now() - start;
    console.log(
      `card-grid sweep: ${widths.length} widths solved and asserted in ${elapsed.toFixed(2)}ms`,
    );
    expect(failures).toEqual([]);
    expect(elapsed).toBeLessThan(250);
  });
});
