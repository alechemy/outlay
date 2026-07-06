import * as fs from "fs";
import * as path from "path";
import puppeteer, { Browser } from "puppeteer";
import {
  BoxSides,
  LayoutNode,
  MarginBoxSides,
  TrackListEntry,
} from "../src/types";
import { expandTrackList } from "../src/grid";
import { gridStyleDeclarations } from "./grid-css";

type GenNode = Omit<
  LayoutNode,
  "padding" | "margin" | "border" | "children"
> & {
  padding: BoxSides;
  margin: MarginBoxSides;
  border: BoxSides;
  children: GenNode[];
};

class RNG {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  nextRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  nextChoice<T>(choices: readonly T[]): T {
    return choices[this.nextRange(0, choices.length - 1)] as T;
  }
}

function genBoxSides(rng: RNG, max: number) {
  return {
    top: rng.nextRange(0, max),
    right: rng.nextRange(0, max),
    bottom: rng.nextRange(0, max),
    left: rng.nextRange(0, max),
  };
}

let idCounter = 1;
let tier10Config = { category: 0, maxDepth: 1 };
let tier13Config = { category: 0 };
let tier15Config = { category: 0 };
let tier16Config = { category: 0 };
let tier17Config = { category: 0 };
let tier18Config = { category: 0 };
let tier19Config = { category: 0 };
let tier20Config = { category: 0 };
let tier21Config = { category: 0 };
let tier22Config = { category: 0 };
let tier23Config = { category: 0 };
let tier24Config = { category: 0 };
let tier26Config = { category: 0 };
let tier27Config = { category: 0 };
let tier28Config = { category: 0 };
let tier29Config = { category: 0 };
let tier30Config = { category: 0 };
let tier31Config = { category: 0 };
let tier32Config: {
  category: number;
  dir: "row" | "column";
  cells: number;
} = {
  category: 0,
  dir: "row",
  cells: 4,
};
let tier33Config: { category: number; dir: "row" | "column" } = {
  category: 0,
  dir: "row",
};
let tier34Config = { category: 0 };

const TEXT_FONT = "16px Arial";
const TEXT_LINE_HEIGHT = 20;
const TEXT_CORPUS = [
  "a", "in", "to", "of", "the", "and", "for", "box", "grid", "flex", "word",
  "line", "text", "wrap", "layout", "column", "render", "spacing", "measure",
  "content", "wrapping", "container", "constraint", "typography", "dimension",
  "alignment", "distribution", "hyphenation", "internationalization",
];

function genTextString(rng: RNG, minWords: number, maxWords: number): string {
  const n = rng.nextRange(minWords, maxWords);
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(rng.nextChoice(TEXT_CORPUS));
  return words.join(" ");
}

function maybeLiteralAuto(node: LayoutNode, rng: RNG, depth: number) {
  if (node.width === undefined && rng.next() < 0.15) node.width = "auto";
  if (node.height === undefined && rng.next() < 0.15) node.height = "auto";
  if (depth === 0 && node.flexBasis === undefined && rng.next() < 0.15) {
    node.flexBasis = "auto";
  }
}

function genGap(rng: RNG): number | { row: number; column: number } {
  return rng.next() < 0.5
    ? rng.nextRange(0, 40)
    : { row: rng.nextRange(0, 40), column: rng.nextRange(0, 40) };
}

function assignGridPlacements(node: LayoutNode, rng: RNG, allowSpans: boolean) {
  const cols = expandTrackList(node.gridTemplateColumns).length;
  const rows = expandTrackList(node.gridTemplateRows).length;
  const cells: Array<{ c: number; r: number }> = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) cells.push({ c, r });
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = rng.nextRange(0, i);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  node.children!.forEach((child, idx) => {
    const cell = cells[idx % cells.length];
    if (allowSpans && rng.next() < 0.5) {
      const colSpan = rng.nextRange(1, Math.max(1, cols - cell.c + 1));
      const rowSpan = rng.nextRange(1, Math.max(1, rows - cell.r + 1));
      child.gridColumn = { start: cell.c, end: cell.c + colSpan };
      child.gridRow =
        rng.next() < 0.5
          ? { start: cell.r, end: cell.r + rowSpan }
          : { start: cell.r, end: "auto" };
    } else {
      child.gridColumn =
        rng.next() < 0.3
          ? { start: cell.c, end: "auto" }
          : { start: cell.c, end: cell.c + 1 };
      child.gridRow = { start: cell.r, end: cell.r + 1 };
    }
  });
}

function assignTier21Placements(node: LayoutNode, rng: RNG, cat: number) {
  const cols = expandTrackList(node.gridTemplateColumns).length;
  const rows = expandTrackList(node.gridTemplateRows).length;
  for (const child of node.children!) {
    if (cat === 0) {
      const c = rng.nextRange(1, cols);
      const r = rng.nextRange(1, rows);
      const colSpan = rng.nextRange(1, Math.max(1, Math.min(3, cols - c + 1)));
      const rowSpan = rng.nextRange(1, Math.max(1, Math.min(2, rows - r + 1)));
      child.gridColumn =
        rng.next() < 0.5
          ? { start: c, end: c + colSpan }
          : { start: c, end: `span ${colSpan}` as `span ${number}` };
      child.gridRow = { start: r, end: r + rowSpan };
    } else if (cat === 2) {
      const roll = rng.next();
      if (roll < 0.3) {
        child.gridColumn = { start: rng.nextRange(1, cols), end: "auto" };
        child.gridRow = { start: rng.nextRange(1, rows), end: "auto" };
      } else if (roll < 0.6) {
        child.gridRow = { start: rng.nextRange(1, rows + 1), end: "auto" };
      }
    } else if (cat === 3) {
      if (rng.next() < 0.3) {
        child.gridColumn = { start: rng.nextRange(1, cols + 1), end: "auto" };
      }
    } else if (cat === 4) {
      if (rng.next() < 0.6) {
        const span = rng.nextRange(1, Math.max(2, Math.min(3, cols)));
        child.gridColumn = {
          start: "auto",
          end: `span ${span}` as `span ${number}`,
        };
      }
      if (rng.next() < 0.3) {
        child.gridRow = {
          start: "auto",
          end: `span ${rng.nextRange(1, 2)}` as `span ${number}`,
        };
      }
    }
  }
}

function genNode(rng: RNG, depth: number, tier: number): GenNode {
  const id = idCounter === 1 ? "root-node" : `node-${idCounter}`;
  idCounter++;

  let isLeaf = false; // Set to true for items that should have no children despite depth > 0

  const padding = genBoxSides(rng, 20);
  const margin = genBoxSides(rng, 20);
  const border = genBoxSides(rng, 10);
  const boxSizing = rng.nextChoice(["content-box", "border-box"] as const);

  const node: GenNode = {
    id,
    padding,
    margin,
    border,
    boxSizing,
    display: "block",
    children: [],
  };

  if (tier === 1) {
    node.width = rng.nextRange(50, 300);
    node.height = rng.nextRange(50, 300);
    // Prevent sibling margin collapse for Tier 1 standard block layout
    node.margin.bottom = 0;
    // Ensure border > 0 or padding > 0 to prevent parent/child margin collapse
    if (node.border.top === 0 && node.padding.top === 0) node.border.top = 1;
    if (node.border.bottom === 0 && node.padding.bottom === 0)
      node.border.bottom = 1;
  } else if (tier === 2) {
    if (depth > 0) {
      // Flex Container
      node.display = "flex";
      node.flexDirection = "row";
      node.flexWrap = "nowrap";
      // Definite main size
      node.width = rng.nextRange(300, 800);
      node.height = rng.nextRange(100, 300);
    } else {
      // Flex Item
      node.height = rng.nextRange(50, 150);
      node.flexGrow = rng.nextRange(0, 3);
      node.flexShrink = 0;
      node.flexBasis = rng.nextChoice([0, rng.nextRange(20, 100)]);
      // width is undefined, let flex basis drive main size
    }
  } else if (tier === 3) {
    if (depth > 0) {
      // Flex Container — deliberately small so items overflow and trigger shrink
      node.display = "flex";
      node.flexDirection = "row";
      node.flexWrap = "nowrap";
      node.width = rng.nextRange(200, 500);
      node.height = rng.nextRange(100, 300);
    } else {
      // Flex Item with shrink + min/max constraints
      node.height = rng.nextRange(50, 150);
      node.flexGrow = rng.nextRange(0, 2);
      node.flexShrink = rng.nextChoice([0, 1, 1, 2, 3]); // bias toward non-zero shrink
      // Large basis to create overflow
      node.flexBasis = rng.nextRange(80, 250);
      // Add min/max constraints with ~50% probability each
      if (rng.next() < 0.5) {
        node.minWidth = rng.nextRange(20, 120);
      }
      if (rng.next() < 0.5) {
        node.maxWidth = rng.nextRange(100, 350);
      }
    }
  } else if (tier === 4) {
    if (depth > 0) {
      // Flex Container — row or column direction, with definite sizes
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.flexWrap = "nowrap";
      node.width = rng.nextRange(300, 600);
      node.height = rng.nextRange(200, 500);
      // align-items on the container
      node.alignItems = rng.nextChoice([
        "flex-start",
        "flex-end",
        "center",
        "stretch",
      ] as const);
    } else {
      // Flex Item with cross-axis properties
      // Some items have definite cross size, some don't (for stretch testing)
      if (rng.next() < 0.6) {
        node.height = rng.nextRange(30, 150);
      }
      if (rng.next() < 0.6) {
        node.width = rng.nextRange(30, 150);
      }
      node.flexGrow = rng.nextRange(0, 2);
      node.flexShrink = rng.nextChoice([0, 1, 1]);
      node.flexBasis = rng.nextChoice([0, rng.nextRange(20, 100)]);
      // align-self override on ~40% of items
      if (rng.next() < 0.4) {
        node.alignSelf = rng.nextChoice([
          "auto",
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
    }
  } else if (tier === 5) {
    if (depth > 0) {
      // Flex Container with justify-content
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.flexWrap = "nowrap";
      node.width = rng.nextRange(300, 700);
      node.height = rng.nextRange(200, 500);
      node.justifyContent = rng.nextChoice([
        "flex-start",
        "flex-end",
        "center",
        "space-between",
        "space-around",
        "space-evenly",
      ] as const);
    } else {
      // Flex Item — some with auto margins on main axis
      node.height = rng.nextRange(30, 150);
      node.width = rng.nextRange(30, 150);
      node.flexGrow = rng.nextChoice([0, 0, 1]);
      node.flexShrink = rng.nextChoice([0, 1]);
      node.flexBasis = rng.nextChoice([0, rng.nextRange(20, 80)]);
      // ~35% chance of auto margins on main axis
      if (rng.next() < 0.35) {
        const autoMode = rng.nextChoice(["start", "end", "both"] as const);
        // We'll set main-axis auto margins; the axis depends on the parent's
        // flex-direction, but since we don't know it here, we set both
        // horizontal and vertical auto margins and let the HTML handle it.
        // Actually, we always set left/right for row and top/bottom for column,
        // but we don't know the parent direction here. Instead, mark both axes
        // and the parent direction will determine which matters.
        if (autoMode === "start" || autoMode === "both") {
          (node.margin as any).left = "auto";
          (node.margin as any).top = "auto";
        }
        if (autoMode === "end" || autoMode === "both") {
          (node.margin as any).right = "auto";
          (node.margin as any).bottom = "auto";
        }
      }
    }
  } else if (tier === 6) {
    if (depth > 0) {
      // Flex Container with wrapping
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.flexWrap = rng.nextChoice(["wrap", "wrap-reverse"] as const);
      node.width = rng.nextRange(200, 400);
      node.height = rng.nextRange(200, 400);
      node.alignContent = rng.nextChoice([
        "flex-start",
        "flex-end",
        "center",
        "stretch",
        "space-between",
        "space-around",
      ] as const);
      if (rng.next() < 0.5) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
    } else {
      // Flex Item — sized to force wrapping
      node.width = rng.nextRange(40, 150);
      node.height = rng.nextRange(30, 100);
      node.flexGrow = rng.nextChoice([0, 0, 1]);
      node.flexShrink = rng.nextChoice([0, 0, 1]);
      if (rng.next() < 0.5) {
        node.flexBasis = rng.nextRange(30, 120);
      }
      // Sometimes remove cross dimension for stretch testing
      if (rng.next() < 0.25) {
        delete (node as any).height;
      }
    }
  } else if (tier === 8) {
    if (depth > 0) {
      // Flex Container
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "row", "column"] as const);
      node.flexWrap = "nowrap";
      node.width = rng.nextRange(300, 700);
      node.height = rng.nextRange(200, 500);
      // ~15% chance of min-content/max-content width
      const widthMode = rng.next();
      if (widthMode < 0.08) {
        node.width = "min-content" as any;
      } else if (widthMode < 0.16) {
        node.width = "max-content" as any;
      }
      if (rng.next() < 0.3) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
      if (rng.next() < 0.2) {
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "space-between",
        ] as const);
      }
    } else {
      // Leaf items — mix of content items and explicit-size items
      const hasContent = rng.next() < 0.6;
      if (hasContent) {
        // Content item: no explicit width/height, size driven by measureContent
        isLeaf = true;
        const basisChoice = rng.next();
        if (basisChoice < 0.5) {
          // flex-basis: auto (default) — falls back to content size
          // Leave flexBasis undefined
        } else if (basisChoice < 0.75) {
          node.flexBasis = "content" as any;
        } else {
          // Numeric flex-basis — content provides auto min-width
          node.flexBasis = rng.nextRange(20, 120);
        }
        node.flexGrow = rng.nextChoice([0, 0, 1, 2]);
        node.flexShrink = rng.nextChoice([0, 1, 1]);
        // Store content dimensions (will be extracted into contentMeasurements)
        const contentWidth = rng.nextRange(30, 150);
        const contentHeight = rng.nextRange(20, 80);
        (node as any)._contentWidth = contentWidth;
        (node as any)._contentHeight = contentHeight;
      } else {
        // Explicit-size item (no content callback)
        isLeaf = true;
        node.width = rng.nextRange(40, 200);
        node.height = rng.nextRange(30, 150);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1, 1]);
        node.flexBasis = rng.nextChoice([0, rng.nextRange(20, 100)]);
      }
    }
  } else if (tier === 9) {
    if (depth > 0) {
      // Flex Container with reverse direction
      node.display = "flex";
      node.flexDirection = rng.nextChoice([
        "row-reverse",
        "row-reverse",
        "column-reverse",
        "column-reverse",
        "row",
        "column",
      ] as const);
      node.flexWrap = rng.nextChoice([
        "nowrap",
        "nowrap",
        "nowrap",
        "wrap",
        "wrap-reverse",
      ] as const);
      node.width = rng.nextRange(200, 600);
      node.height = rng.nextRange(200, 500);
      node.justifyContent = rng.nextChoice([
        "flex-start",
        "flex-end",
        "center",
        "space-between",
        "space-around",
        "space-evenly",
      ] as const);
      if (rng.next() < 0.5) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
      if (node.flexWrap !== "nowrap" && rng.next() < 0.5) {
        node.alignContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
          "space-between",
          "space-around",
        ] as const);
      }
    } else {
      // Flex Item with order property
      node.width = rng.nextRange(30, 150);
      node.height = rng.nextRange(30, 120);
      node.flexGrow = rng.nextChoice([0, 0, 1, 2]);
      node.flexShrink = rng.nextChoice([0, 1, 1]);
      if (rng.next() < 0.4) {
        node.flexBasis = rng.nextRange(20, 100);
      }
      // ~60% chance of order property
      if (rng.next() < 0.6) {
        node.order = rng.nextRange(-2, 5);
      }
      if (rng.next() < 0.3) {
        node.alignSelf = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
    }
  } else if (tier === 10) {
    const { category, maxDepth } = tier10Config;

    if (category === 0) {
      // Zero-size containers
      if (depth > 0) {
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        // Simplify box model for root to avoid box-sizing complications
        node.padding = { top: 0, right: 0, bottom: 0, left: 0 };
        node.border = { top: 0, right: 0, bottom: 0, left: 0 };
        node.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        node.boxSizing = "border-box";
        const zeroWidth = rng.next() < 0.6;
        const zeroHeight = rng.next() < 0.6;
        node.width = zeroWidth ? 0 : rng.nextRange(200, 500);
        node.height = zeroHeight ? 0 : rng.nextRange(200, 500);
      } else {
        node.width = rng.nextRange(20, 100);
        node.height = rng.nextRange(20, 80);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
      }
    } else if (category === 1) {
      // Deep nesting
      if (depth > 0) {
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        if (depth === maxDepth) {
          // Root: definite size
          node.width = rng.nextRange(300, 600);
          node.height = rng.nextRange(300, 600);
        } else {
          // Intermediate: flex container that is also a flex item
          if (rng.next() < 0.6) node.width = rng.nextRange(50, 200);
          if (rng.next() < 0.6) node.height = rng.nextRange(50, 200);
          node.flexGrow = rng.nextChoice([0, 1, 1]);
          node.flexShrink = rng.nextChoice([0, 1]);
          if (rng.next() < 0.4) node.flexBasis = rng.nextRange(30, 150);
        }
      } else {
        // Leaf
        node.width = rng.nextRange(20, 80);
        node.height = rng.nextRange(20, 80);
        node.flexGrow = rng.nextChoice([0, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
      }
    } else if (category === 2) {
      // No flexibility (flex-grow: 0, flex-shrink: 0)
      if (depth > 0) {
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = rng.nextChoice(["nowrap", "nowrap", "wrap"] as const);
        node.width = rng.nextRange(200, 600);
        node.height = rng.nextRange(200, 500);
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "space-between",
          "space-around",
        ] as const);
        if (rng.next() < 0.5) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
      } else {
        node.width = rng.nextRange(30, 120);
        node.height = rng.nextRange(30, 100);
        node.flexGrow = 0;
        node.flexShrink = 0;
        node.flexBasis = rng.nextChoice([0, rng.nextRange(20, 100)]);
      }
    } else if (category === 3) {
      // Negative margins
      if (depth > 0) {
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(300, 600);
        node.height = rng.nextRange(200, 500);
      } else {
        node.width = rng.nextRange(40, 150);
        node.height = rng.nextRange(30, 120);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
        // Randomly negate some margins
        if (rng.next() < 0.6) node.margin.left = -rng.nextRange(1, 20);
        if (rng.next() < 0.6) node.margin.top = -rng.nextRange(1, 20);
        if (rng.next() < 0.3) node.margin.right = -rng.nextRange(1, 15);
        if (rng.next() < 0.3) node.margin.bottom = -rng.nextRange(1, 15);
      }
    } else if (category === 4) {
      // Large values (numeric stability)
      if (depth > 0) {
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(1000, 5000);
        node.height = rng.nextRange(1000, 5000);
      } else {
        node.width = rng.nextRange(200, 2000);
        node.height = rng.nextRange(200, 2000);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
        node.flexBasis = rng.nextChoice([0, rng.nextRange(100, 1000)]);
      }
    } else if (category === 5) {
      // display:none children interleaved with visible ones
      if (depth > 0) {
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(300, 600);
        node.height = rng.nextRange(200, 400);
        if (rng.next() < 0.5) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
      } else {
        if (rng.next() < 0.33) {
          // display:none item — no layout dimensions needed
          node.display = "none";
        } else {
          node.width = rng.nextRange(30, 120);
          node.height = rng.nextRange(30, 100);
          node.flexGrow = rng.nextChoice([0, 0, 1]);
          node.flexShrink = rng.nextChoice([0, 1]);
        }
      }
    }
  } else if (tier === 11) {
    if (depth > 0) {
      // Flex container that acts as containing block for absolute children.
      // Root has position:absolute from the CSS rule, so no position property
      // needed on the input node — the solver treats root as always a CB.
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "column", "row", "row"] as const);
      node.flexWrap = "nowrap";
      node.width = rng.nextRange(300, 700);
      node.height = rng.nextRange(200, 500);
      if (rng.next() < 0.5) {
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
        ] as const);
      }
      if (rng.next() < 0.4) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
    } else {
      // Child: either a normal flex item or an absolutely-positioned element
      const isAbsolute = rng.next() < 0.4;
      if (isAbsolute) {
        node.position = "absolute";
        // Keep box model simple for abs children
        node.padding = { top: 0, right: 0, bottom: 0, left: 0 };
        node.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        node.border = { top: 0, right: 0, bottom: 0, left: 0 };
        node.boxSizing = "border-box";

        const strategy = rng.nextRange(0, 3);
        if (strategy === 0) {
          // left + top, explicit size
          node.left = rng.nextRange(0, 100);
          node.top = rng.nextRange(0, 100);
          node.width = rng.nextRange(50, 150);
          node.height = rng.nextRange(50, 150);
        } else if (strategy === 1) {
          // right + bottom, explicit size
          node.right = rng.nextRange(0, 100);
          node.bottom = rng.nextRange(0, 100);
          node.width = rng.nextRange(50, 150);
          node.height = rng.nextRange(50, 150);
        } else if (strategy === 2) {
          // all 4 insets — width/height determined by stretch
          node.left = rng.nextRange(10, 80);
          node.right = rng.nextRange(10, 80);
          node.top = rng.nextRange(10, 80);
          node.bottom = rng.nextRange(10, 80);
        } else {
          // two insets in one axis, one in the other + explicit size
          if (rng.next() < 0.5) {
            node.left = rng.nextRange(10, 60);
            node.right = rng.nextRange(10, 60);
            node.top = rng.nextRange(10, 60);
            node.height = rng.nextRange(50, 150);
          } else {
            node.top = rng.nextRange(10, 60);
            node.bottom = rng.nextRange(10, 60);
            node.left = rng.nextRange(10, 60);
            node.width = rng.nextRange(50, 150);
          }
        }
      } else {
        // Normal flex item
        node.width = rng.nextRange(30, 150);
        node.height = rng.nextRange(30, 120);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
        if (rng.next() < 0.3) node.flexBasis = rng.nextRange(20, 100);
      }
    }
  } else if (tier === 12) {
    // Tier 12: position:fixed (relative to root) and nested absolute positioning.
    //
    // Category 0 (even seeds): position:fixed children — positioned relative to root.
    // Category 1 (odd seeds):  nested absolute — an intermediate flex child has
    //   position:relative and contains its own absolute grandchildren.
    //
    // depth=2: root (depth 2) → intermediates (depth 1) → leaves (depth 0)
    // depth=1 for category 0 (flat, like Tier 11)
    const cat = (node.id === "root-node" ? 0 : 0); // determined per-fixture in generateFixtures

    if (depth === 2) {
      // Root flex container = the "viewport" for position:fixed children.
      // Must have margin=border=padding=0 and match Puppeteer's 800×600 viewport
      // so that fixed children are positioned correctly relative to the viewport.
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "column", "row"] as const);
      node.flexWrap = "nowrap";
      node.width = 800;
      node.height = 600;
      node.padding = { top: 0, right: 0, bottom: 0, left: 0 };
      node.border = { top: 0, right: 0, bottom: 0, left: 0 };
      node.margin = { top: 0, right: 0, bottom: 0, left: 0 };
      node.boxSizing = "border-box";
      if (rng.next() < 0.4) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
    } else if (depth === 1) {
      // Intermediate node: a flex item that is also a positioned container
      // with absolute children. Set position:relative to establish a CB.
      node.display = "flex";
      node.position = "relative";
      node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.flexWrap = "nowrap";
      node.width = rng.nextRange(100, 300);
      node.height = rng.nextRange(80, 250);
      node.flexGrow = rng.nextChoice([0, 1, 1]);
      node.flexShrink = rng.nextChoice([0, 1]);
    } else {
      // Leaf: either a fixed child, nested absolute child, or normal flex item
      const role = rng.nextRange(0, 2);
      if (role === 0) {
        // position:fixed — uses root as containing block
        node.position = "fixed";
        node.padding = { top: 0, right: 0, bottom: 0, left: 0 };
        node.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        node.border = { top: 0, right: 0, bottom: 0, left: 0 };
        node.boxSizing = "border-box";
        const strategy = rng.nextRange(0, 2);
        if (strategy === 0) {
          node.left = rng.nextRange(0, 80);
          node.top = rng.nextRange(0, 80);
          node.width = rng.nextRange(40, 120);
          node.height = rng.nextRange(40, 120);
        } else if (strategy === 1) {
          node.right = rng.nextRange(0, 80);
          node.bottom = rng.nextRange(0, 80);
          node.width = rng.nextRange(40, 120);
          node.height = rng.nextRange(40, 120);
        } else {
          node.left = rng.nextRange(10, 60);
          node.right = rng.nextRange(10, 60);
          node.top = rng.nextRange(10, 60);
          node.bottom = rng.nextRange(10, 60);
        }
      } else if (role === 1) {
        // position:absolute — uses nearest positioned ancestor (depth-1 node) as CB
        node.position = "absolute";
        node.padding = { top: 0, right: 0, bottom: 0, left: 0 };
        node.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        node.border = { top: 0, right: 0, bottom: 0, left: 0 };
        node.boxSizing = "border-box";
        const strategy = rng.nextRange(0, 2);
        if (strategy === 0) {
          node.left = rng.nextRange(0, 60);
          node.top = rng.nextRange(0, 60);
          node.width = rng.nextRange(30, 100);
          node.height = rng.nextRange(30, 100);
        } else if (strategy === 1) {
          node.right = rng.nextRange(0, 60);
          node.bottom = rng.nextRange(0, 60);
          node.width = rng.nextRange(30, 100);
          node.height = rng.nextRange(30, 100);
        } else {
          node.left = rng.nextRange(5, 50);
          node.right = rng.nextRange(5, 50);
          node.top = rng.nextRange(5, 50);
          node.bottom = rng.nextRange(5, 50);
        }
      } else {
        // Normal in-flow flex item
        node.width = rng.nextRange(30, 100);
        node.height = rng.nextRange(30, 80);
        node.flexGrow = rng.nextChoice([0, 1, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
      }
    }
  } else if (tier === 13) {
    // Tier 13: gap coverage.
    // Category 0: row/column nowrap, grow under gap-reduced free space
    // Category 1: shrink under gap-reduced space, min/max width constraints
    // Category 2: wrap/wrap-reverse — gap in line breaking + row-gap between lines
    // Category 3: reverse directions with justify-content
    // Category 4: justify-content spacing values with inflexible items
    // Category 5: nested containers with differing gaps (depth 2)
    const { category } = tier13Config;
    if (depth > 0) {
      node.display = "flex";
      node.gap = genGap(rng);
      if (category === 0) {
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(300, 700);
        node.height = rng.nextRange(200, 500);
      } else if (category === 1) {
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(200, 450);
        node.height = rng.nextRange(150, 400);
      } else if (category === 2) {
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = rng.nextChoice(["wrap", "wrap-reverse"] as const);
        node.width = rng.nextRange(200, 400);
        node.height = rng.nextRange(200, 400);
        node.alignContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
          "space-between",
          "space-around",
        ] as const);
        if (rng.next() < 0.5) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
      } else if (category === 3) {
        node.flexDirection = rng.nextChoice([
          "row-reverse",
          "column-reverse",
        ] as const);
        node.flexWrap = rng.nextChoice(["nowrap", "nowrap", "wrap"] as const);
        node.width = rng.nextRange(250, 600);
        node.height = rng.nextRange(200, 500);
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "space-between",
          "space-around",
          "space-evenly",
        ] as const);
      } else if (category === 4) {
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(350, 700);
        node.height = rng.nextRange(300, 600);
        node.justifyContent = rng.nextChoice([
          "space-between",
          "space-around",
          "space-evenly",
          "center",
          "flex-end",
        ] as const);
      } else {
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        if (depth === 2) {
          node.width = rng.nextRange(400, 800);
          node.height = rng.nextRange(300, 600);
        } else {
          if (rng.next() < 0.5) node.width = rng.nextRange(100, 300);
          if (rng.next() < 0.4) node.height = rng.nextRange(80, 250);
          node.flexGrow = rng.nextChoice([0, 1, 1]);
          node.flexShrink = rng.nextChoice([0, 1]);
        }
      }
    } else {
      if (category === 1) {
        node.height = rng.nextRange(50, 150);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([1, 1, 2, 3]);
        node.flexBasis = rng.nextRange(80, 250);
        if (rng.next() < 0.4) node.minWidth = rng.nextRange(20, 120);
        if (rng.next() < 0.4) node.maxWidth = rng.nextRange(100, 350);
      } else if (category === 2 || category === 3) {
        node.width = rng.nextRange(40, 150);
        node.height = rng.nextRange(30, 100);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 0, 1]);
        if (rng.next() < 0.25) delete (node as any).height;
      } else if (category === 4) {
        node.width = rng.nextRange(30, 120);
        node.height = rng.nextRange(30, 120);
        node.flexGrow = 0;
        node.flexShrink = 0;
      } else {
        node.width = rng.nextRange(30, 150);
        node.height = rng.nextRange(30, 120);
        node.flexGrow = rng.nextRange(0, 2);
        node.flexShrink = rng.nextChoice([0, 1, 1]);
        node.flexBasis = rng.nextChoice([0, rng.nextRange(20, 100)]);
      }
    }
  } else if (tier === 14) {
    // Tier 14: minHeight/maxHeight — main-axis constraints in column trees,
    // cross-axis constraints in row trees.
    if (depth > 0) {
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.flexWrap = rng.nextChoice([
        "nowrap",
        "nowrap",
        "nowrap",
        "wrap",
      ] as const);
      node.width = rng.nextRange(250, 600);
      node.height = rng.nextRange(150, 450);
      if (rng.next() < 0.5) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
      if (rng.next() < 0.3) {
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "space-between",
        ] as const);
      }
    } else {
      if (rng.next() < 0.6) node.height = rng.nextRange(30, 200);
      if (rng.next() < 0.6) node.width = rng.nextRange(30, 150);
      node.flexGrow = rng.nextChoice([0, 0, 1, 2]);
      node.flexShrink = rng.nextChoice([0, 1, 1, 2]);
      if (rng.next() < 0.4) node.flexBasis = rng.nextRange(40, 250);
      if (rng.next() < 0.5) node.minHeight = rng.nextRange(20, 120);
      if (rng.next() < 0.5) node.maxHeight = rng.nextRange(60, 250);
    }
  } else if (tier === 15) {
    // Tier 15: align-items/align-self baseline.
    // cat 0: row, alignItems baseline, fixed height, leaf items.
    // cat 1: row, alignItems baseline, AUTO height (line cross = maxAscent+maxDescent).
    // cat 2: row, wrap, alignItems baseline, align-content — per-line baseline groups.
    // cat 3: row, container uses another alignItems; subset of items alignSelf baseline.
    // cat 4: row, alignItems baseline, some items are nested flex containers (depth 2).
    // cat 5: column direction, alignItems baseline (fallback to flex-start).
    const cat = tier15Config.category;
    if (cat === 4) {
      if (depth === 2) {
        node.display = "flex";
        node.flexDirection = "row";
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(400, 800);
        node.height = rng.nextRange(220, 420);
        node.alignItems = "baseline";
        if (rng.next() < 0.3) {
          node.justifyContent = rng.nextChoice([
            "flex-start",
            "center",
            "space-between",
          ] as const);
        }
      } else if (depth === 1) {
        const isNested = rng.next() < 0.55;
        if (isNested) {
          // Nested flex container as a baseline item. Default alignItems (stretch)
          // keeps the first child at cross-start so its baseline is well-defined.
          node.display = "flex";
          node.flexDirection = rng.nextChoice(["row", "column"] as const);
          node.flexWrap = "nowrap";
          if (rng.next() < 0.5) node.width = rng.nextRange(70, 180);
          node.flexGrow = 0;
          node.flexShrink = rng.nextChoice([0, 1] as const);
        } else {
          isLeaf = true;
          node.height = rng.nextRange(30, 150);
          node.width = rng.nextRange(30, 120);
          node.flexGrow = 0;
          node.flexShrink = rng.nextChoice([0, 1] as const);
        }
      } else {
        // Grandchild leaf: definite height keeps the nested baseline stable.
        node.height = rng.nextRange(20, 90);
        node.width = rng.nextRange(20, 90);
        node.flexGrow = 0;
        node.flexShrink = rng.nextChoice([0, 1] as const);
      }
    } else if (depth > 0) {
      node.display = "flex";
      node.flexDirection = cat === 5 ? "column" : "row";
      node.flexWrap = cat === 2 ? rng.nextChoice(["wrap", "wrap-reverse", "wrap"] as const) : "nowrap";
      node.width = rng.nextRange(cat === 2 ? 200 : 350, cat === 2 ? 420 : 720);
      if (cat === 1 || cat === 2) {
        // Auto cross size: container height derives from baseline line math.
        if (cat === 2) node.height = rng.nextRange(250, 500);
      } else {
        node.height = rng.nextRange(220, 460);
      }
      if (cat === 3) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      } else {
        node.alignItems = "baseline";
      }
      if (cat === 2) {
        node.alignContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
          "space-between",
          "space-around",
        ] as const);
      }
    } else {
      // Leaf item with a varied box model so baselines differ.
      if (rng.next() < 0.85) node.height = rng.nextRange(20, 150);
      node.width = rng.nextRange(30, 130);
      node.flexGrow = 0;
      node.flexShrink = rng.nextChoice([0, 1] as const);
      if (cat === 3) {
        node.alignSelf =
          rng.next() < 0.55
            ? "baseline"
            : rng.nextChoice(["auto", "flex-start", "center"] as const);
      } else if (cat !== 5 && rng.next() < 0.2) {
        node.alignSelf = rng.nextChoice(["baseline", "auto"] as const);
      }
    }
  } else if (tier === 16) {
    // Tier 16: keyword sizing (min-content / max-content) on container heights
    // and on flex items (widths and heights).
    // cat 0: row container, height keyword (cross-axis container sizing).
    // cat 1: column container, height keyword (main-axis container sizing).
    // cat 2: leaf items with keyword width/height, mixed grow/shrink.
    // cat 3: nested flex items with keyword width/height (depth 2).
    // cat 4: measureContent leaf items with keyword width.
    // cat 5: container width keyword (row + column) with gap.
    const cat = tier16Config.category;
    const kw = () => rng.nextChoice(["min-content", "max-content"] as const);
    if (cat === 3) {
      if (depth === 2) {
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(400, 800);
        node.height = rng.nextRange(200, 450);
        if (rng.next() < 0.5) node.gap = genGap(rng);
      } else if (depth === 1) {
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        if (rng.next() < 0.65) node.width = kw() as any;
        else node.width = rng.nextRange(80, 220);
        if (rng.next() < 0.4) node.height = kw() as any;
        node.flexGrow = rng.nextChoice([0, 0, 1] as const);
        node.flexShrink = rng.nextChoice([0, 1] as const);
      } else {
        node.width = rng.nextRange(30, 100);
        node.height = rng.nextRange(20, 90);
        node.flexGrow = rng.nextChoice([0, 1] as const);
        node.flexShrink = rng.nextChoice([0, 1] as const);
      }
    } else if (depth > 0) {
      node.display = "flex";
      if (cat === 0) node.flexDirection = "row";
      else if (cat === 1) node.flexDirection = "column";
      else node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.flexWrap = "nowrap";
      if (cat === 0) {
        node.width = rng.nextRange(300, 700);
        node.height = kw() as any;
      } else if (cat === 1) {
        node.width = rng.nextRange(150, 400);
        node.height = kw() as any;
      } else if (cat === 5) {
        node.width = kw() as any;
        node.height = rng.nextRange(160, 420);
      } else {
        node.width = rng.nextRange(300, 700);
        node.height = rng.nextRange(160, 420);
      }
      if (rng.next() < 0.45) node.gap = genGap(rng);
      if (rng.next() < 0.3) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
    } else {
      // Leaf item.
      if (cat === 4) {
        isLeaf = true;
        (node as any)._contentWidth = rng.nextRange(30, 150);
        (node as any)._contentHeight = rng.nextRange(20, 80);
        if (rng.next() < 0.6) node.width = kw() as any;
        if (rng.next() < 0.4) node.height = kw() as any;
        node.flexGrow = rng.nextChoice([0, 0, 1] as const);
        node.flexShrink = rng.nextChoice([0, 1] as const);
      } else if (cat === 2) {
        if (rng.next() < 0.55) node.width = kw() as any;
        else node.width = rng.nextRange(40, 120);
        if (rng.next() < 0.5) node.height = kw() as any;
        else node.height = rng.nextRange(30, 120);
        node.flexGrow = rng.nextChoice([0, 0, 1] as const);
        node.flexShrink = rng.nextChoice([0, 1] as const);
      } else {
        node.width = rng.nextRange(40, 150);
        node.height = rng.nextRange(30, 120);
        node.flexGrow = rng.nextChoice([0, 0, 1] as const);
        node.flexShrink = rng.nextChoice([0, 1] as const);
      }
    }
    maybeLiteralAuto(node, rng, depth);
  } else if (tier === 17) {
    // Tier 17: block containers with children nested inside flex trees.
    // Every box is definite-size with zero vertical margins, isolating the
    // block layout path from margin collapse (a documented non-goal).
    const cat = tier17Config.category;
    node.margin.top = 0;
    node.margin.bottom = 0;
    if (depth === 3) {
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.flexWrap = "nowrap";
      node.width = rng.nextRange(400, 800);
      node.height = rng.nextRange(300, 600);
      if (rng.next() < 0.4) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
      if (rng.next() < 0.3) {
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "center",
          "space-between",
        ] as const);
      }
    } else if (depth === 2) {
      const isBlock =
        cat === 0 ? true : cat === 1 ? rng.next() < 0.7 : rng.next() < 0.5;
      node.display = isBlock ? "block" : "flex";
      if (!isBlock) node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.width = rng.nextRange(120, 260);
      node.height = rng.nextRange(120, 260);
      node.flexGrow = rng.nextChoice([0, 0, 1] as const);
      // Containers keep their definite size (shrinking a block box below its
      // definite width needs block intrinsic sizing — a documented non-goal).
      node.flexShrink = 0;
    } else if (depth === 1) {
      const isBlock = rng.next() < 0.6;
      node.display = isBlock ? "block" : "flex";
      if (!isBlock) node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.width = rng.nextRange(50, 150);
      node.height = rng.nextRange(40, 120);
      node.flexGrow = rng.nextChoice([0, 1] as const);
      node.flexShrink = 0;
    } else {
      node.display = rng.next() < 0.5 ? "block" : "flex";
      node.width = rng.nextRange(20, 90);
      node.height = rng.nextRange(20, 80);
      node.flexGrow = rng.nextChoice([0, 1] as const);
      node.flexShrink = rng.nextChoice([0, 1] as const);
    }
  } else if (tier === 18) {
    const cat = tier18Config.category;
    if (depth > 0) {
      node.display = "grid";
      node.width = rng.nextRange(200, 700);
      if (cat !== 3) node.height = rng.nextRange(150, 500);
      const colCount = rng.nextRange(2, 4);
      const rowCount = rng.nextRange(2, 3);
      if (cat === 4) {
        node.gridTemplateColumns = [
          { repeat: rng.nextRange(2, 3), tracks: [rng.nextRange(40, 160)] },
        ];
        if (rng.next() < 0.5) {
          node.gridTemplateColumns.push(rng.nextRange(40, 160));
        }
        node.gridTemplateRows = [
          { repeat: rowCount, tracks: [rng.nextRange(30, 120)] },
        ];
      } else {
        node.gridTemplateColumns = Array.from({ length: colCount }, () =>
          rng.nextRange(40, 160),
        );
        node.gridTemplateRows = Array.from({ length: rowCount }, () =>
          rng.nextRange(30, 120),
        );
      }
      if (cat !== 0) node.gap = genGap(rng);
    } else {
      if (rng.next() < 0.4) node.width = rng.nextRange(30, 120);
      if (rng.next() < 0.4) node.height = rng.nextRange(20, 100);
    }
  } else if (tier === 19) {
    const cat = tier19Config.category;
    if (depth > 0) {
      node.display = "grid";
      node.width = rng.nextRange(200, 700);
      if (cat !== 4) node.height = rng.nextRange(150, 500);
      const colCount = rng.nextRange(2, 4);
      const rowCount = rng.nextRange(2, 3);
      const frFactor = () =>
        `${rng.nextChoice([0.5, 1, 1, 2, 3])}fr` as `${number}fr`;
      node.gridTemplateColumns = Array.from({ length: colCount }, () =>
        rng.next() < 0.5 ? frFactor() : rng.nextRange(40, 160),
      );
      if (!node.gridTemplateColumns.some((t) => typeof t === "string")) {
        node.gridTemplateColumns[rng.nextRange(0, colCount - 1)] = "1fr";
      }
      if (cat === 2 || cat === 4) {
        node.gridTemplateRows = Array.from({ length: rowCount }, () =>
          rng.next() < 0.5 ? frFactor() : rng.nextRange(30, 120),
        );
        if (!node.gridTemplateRows.some((t) => typeof t === "string")) {
          node.gridTemplateRows[rng.nextRange(0, rowCount - 1)] = "1fr";
        }
      } else {
        node.gridTemplateRows = Array.from({ length: rowCount }, () =>
          rng.nextRange(30, 120),
        );
      }
      if (cat !== 0) node.gap = genGap(rng);
    } else {
      const wideItems = tier19Config.category === 3;
      if (rng.next() < (wideItems ? 0.8 : 0.5)) {
        node.width = rng.nextRange(30, wideItems ? 400 : 200);
      }
      if (rng.next() < 0.4) node.height = rng.nextRange(20, 120);
    }
  } else if (tier === 20) {
    const cat = tier20Config.category;
    if (depth > 0) {
      node.display = "grid";
      node.width = rng.nextRange(200, 700);
      if (cat !== 4) node.height = rng.nextRange(150, 500);
      const colCount = rng.nextRange(2, 4);
      const rowCount = rng.nextRange(2, 3);
      const genTrack = (axis: "col" | "row"): TrackListEntry => {
        const px = () =>
          axis === "col" ? rng.nextRange(40, 160) : rng.nextRange(30, 120);
        const r = rng.next();
        if (cat === 2) {
          if (r < 0.45) {
            const a = px();
            const b = px();
            return { min: Math.min(a, b), max: Math.max(a, b) };
          }
          if (r < 0.7) {
            return {
              min: px(),
              max: rng.next() < 0.5 ? ("auto" as const) : ("1fr" as const),
            };
          }
          return r < 0.85 ? ("auto" as const) : px();
        }
        if (cat === 3) {
          if (r < 0.3) return "min-content" as const;
          if (r < 0.6) return "max-content" as const;
          return r < 0.8 ? ("auto" as const) : px();
        }
        if (r < 0.5) return "auto" as const;
        return px();
      };
      node.gridTemplateColumns = Array.from({ length: colCount }, () =>
        genTrack("col"),
      );
      node.gridTemplateRows = Array.from({ length: rowCount }, () =>
        genTrack("row"),
      );
      if (cat !== 0) node.gap = genGap(rng);
    } else {
      if (rng.next() < 0.6) node.width = rng.nextRange(30, 200);
      if (rng.next() < 0.6) node.height = rng.nextRange(20, 120);
    }
  } else if (tier === 21) {
    const cat = tier21Config.category;
    if (depth > 0) {
      node.display = "grid";
      node.width = rng.nextRange(200, 700);
      if (!(cat === 1 && rng.next() < 0.5)) {
        node.height = rng.nextRange(150, 500);
      }
      const colCount = rng.nextRange(2, 4);
      const rowCount = rng.nextRange(2, 3);
      const mixedTrack = (px: () => number): TrackListEntry => {
        const r = rng.next();
        if (r < 0.4) return px();
        if (r < 0.75) return "auto";
        return `${rng.nextChoice([1, 1, 2])}fr` as `${number}fr`;
      };
      node.gridTemplateColumns = Array.from({ length: colCount }, () =>
        mixedTrack(() => rng.nextRange(40, 160)),
      );
      node.gridTemplateRows = Array.from({ length: rowCount }, () =>
        mixedTrack(() => rng.nextRange(30, 120)),
      );
      if (rng.next() < 0.7) node.gap = genGap(rng);
      if (cat === 1 || cat === 2) {
        if (rng.next() < 0.7) {
          node.gridAutoRows =
            rng.next() < 0.6 ? rng.nextRange(30, 100) : "auto";
        }
      }
      if (cat === 3) {
        node.gridAutoFlow = "column";
        if (rng.next() < 0.7) {
          node.gridAutoColumns =
            rng.next() < 0.6 ? rng.nextRange(40, 140) : "auto";
        }
      }
      if (cat === 4 && rng.next() < 0.5) {
        node.gridAutoRows = rng.nextRange(30, 100);
      }
    } else {
      if (rng.next() < 0.6) node.width = rng.nextRange(30, 180);
      if (rng.next() < 0.6) node.height = rng.nextRange(20, 110);
    }
  } else if (tier === 22) {
    const cat = tier22Config.category;
    if (depth > 0) {
      node.display = "grid";
      node.width = rng.nextRange(250, 700);
      node.height = rng.nextRange(200, 500);
      const colCount = rng.nextRange(2, 4);
      const rowCount = rng.nextRange(2, 3);
      const track = (px: () => number): TrackListEntry => {
        const r = rng.next();
        if (r < 0.5) return px();
        if (r < 0.8) return "auto";
        return "1fr";
      };
      const fixedTrack = (px: () => number): TrackListEntry =>
        rng.next() < 0.7 ? px() : "auto";
      if (cat === 1 || cat === 2) {
        node.gridTemplateColumns = Array.from({ length: colCount }, () =>
          fixedTrack(() => rng.nextRange(40, 130)),
        );
        node.gridTemplateRows = Array.from({ length: rowCount }, () =>
          fixedTrack(() => rng.nextRange(30, 100)),
        );
      } else {
        node.gridTemplateColumns = Array.from({ length: colCount }, () =>
          track(() => rng.nextRange(40, 160)),
        );
        node.gridTemplateRows = Array.from({ length: rowCount }, () =>
          track(() => rng.nextRange(30, 120)),
        );
      }
      if (rng.next() < 0.7) node.gap = genGap(rng);
      if (cat === 0 || cat === 4) {
        if (rng.next() < 0.7) {
          node.justifyItems = rng.nextChoice([
            "start",
            "end",
            "center",
            "stretch",
          ] as const);
        }
        if (rng.next() < 0.7) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
      }
      if (cat === 1) {
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "space-between",
          "space-around",
          "space-evenly",
        ] as const);
      }
      if (cat === 2) {
        node.alignContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
          "space-between",
          "space-around",
        ] as const);
        if (rng.next() < 0.5) {
          node.justifyContent = rng.nextChoice([
            "flex-start",
            "center",
            "space-between",
          ] as const);
        }
      }
      if (cat === 3) {
        node.gridAutoFlow = rng.next() < 0.7 ? "row dense" : "column dense";
        if (rng.next() < 0.5) {
          node.gridAutoRows = rng.nextRange(30, 90);
        }
      }
    } else {
      if (rng.next() < 0.6) node.width = rng.nextRange(30, 160);
      if (rng.next() < 0.6) node.height = rng.nextRange(20, 110);
      if (cat === 0 && rng.next() < 0.4) {
        node.justifySelf = rng.nextChoice([
          "start",
          "end",
          "center",
          "stretch",
        ] as const);
      }
      if (cat === 0 && rng.next() < 0.4) {
        node.alignSelf = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
      if (cat === 4 && rng.next() < 0.5) {
        const side = rng.next();
        if (side < 0.4) node.margin = { ...genBoxSides(rng, 15), left: "auto" };
        else if (side < 0.7)
          node.margin = { ...genBoxSides(rng, 15), left: "auto", right: "auto" };
        else node.margin = { ...genBoxSides(rng, 15), top: "auto" };
      }
    }
  } else if (tier === 23) {
    const cat = tier23Config.category;
    const smallTrack = (): TrackListEntry => {
      const r = rng.next();
      if (r < 0.45) return rng.nextRange(40, 140);
      if (r < 0.8) return "auto";
      return "1fr";
    };
    if (depth === 2) {
      if (cat === 1) {
        node.display = "flex";
        node.flexDirection = rng.next() < 0.6 ? "row" : "column";
        node.width = rng.nextRange(300, 800);
        node.height = rng.nextRange(200, 500);
        if (rng.next() < 0.5) node.gap = genGap(rng);
        if (rng.next() < 0.3) node.flexWrap = "wrap";
      } else {
        node.display = "grid";
        node.width = rng.nextRange(300, 800);
        if (rng.next() < 0.7) node.height = rng.nextRange(200, 500);
        node.gridTemplateColumns = Array.from(
          { length: rng.nextRange(2, 3) },
          smallTrack,
        );
        node.gridTemplateRows = Array.from(
          { length: rng.nextRange(2, 3) },
          smallTrack,
        );
        if (rng.next() < 0.7) node.gap = genGap(rng);
      }
    } else if (depth === 1) {
      if (cat === 0) {
        node.display = "flex";
        node.flexDirection = rng.next() < 0.6 ? "row" : "column";
        if (rng.next() < 0.4) node.width = rng.nextRange(80, 250);
        if (rng.next() < 0.4) node.height = rng.nextRange(60, 180);
        if (rng.next() < 0.5) node.gap = genGap(rng);
      } else {
        node.display = "grid";
        node.gridTemplateColumns = Array.from(
          { length: rng.nextRange(2, 3) },
          smallTrack,
        );
        node.gridTemplateRows = Array.from(
          { length: 2 },
          smallTrack,
        );
        if (rng.next() < 0.5) node.width = rng.nextRange(100, 300);
        if (rng.next() < 0.5) node.height = rng.nextRange(80, 220);
        if (rng.next() < 0.5) node.gap = genGap(rng);
        if (cat === 1) {
          if (rng.next() < 0.4) node.flexGrow = rng.nextRange(0, 2);
          if (rng.next() < 0.5) node.flexShrink = 0;
        }
      }
    } else {
      if (rng.next() < 0.6) node.width = rng.nextRange(20, 120);
      if (rng.next() < 0.6) node.height = rng.nextRange(15, 90);
    }
  } else if (tier === 24) {
    const cat = tier24Config.category;
    if (depth > 0) {
      node.display = "grid";
      node.width = rng.nextRange(250, 700);
      node.height = rng.nextRange(150, 450);
      const trackPx = () => rng.nextRange(60, 150);
      const fit: "auto-fill" | "auto-fit" =
        cat === 2 ? "auto-fit" : "auto-fill";
      const repeatEntry: TrackListEntry =
        cat === 1 || (cat === 2 && rng.next() < 0.5)
          ? { repeat: fit, tracks: [{ min: trackPx(), max: "1fr" }] }
          : { repeat: fit, tracks: [trackPx()] };
      if (cat === 3) {
        node.gridTemplateColumns =
          rng.next() < 0.5
            ? [trackPx(), repeatEntry]
            : [repeatEntry, trackPx()];
        node.gridTemplateRows =
          rng.next() < 0.5
            ? [{ repeat: "auto-fill", tracks: [rng.nextRange(40, 100)] }]
            : Array.from({ length: 2 }, () => rng.nextRange(40, 110));
      } else {
        node.gridTemplateColumns = [repeatEntry];
        node.gridTemplateRows = Array.from(
          { length: rng.nextRange(1, 2) },
          () => rng.nextRange(40, 110),
        );
      }
      if (rng.next() < 0.8) node.gap = genGap(rng);
      if (rng.next() < 0.5) node.gridAutoRows = rng.nextRange(30, 90);
      if (cat === 2) {
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "space-between",
        ] as const);
      }
    } else {
      if (rng.next() < 0.5) node.width = rng.nextRange(30, 130);
      if (rng.next() < 0.5) node.height = rng.nextRange(20, 90);
    }
  } else if (tier === 25) {
    if (depth > 0) {
      node.display = "grid";
      node.width = rng.nextRange(250, 700);
      if (rng.next() < 0.6) node.height = rng.nextRange(150, 450);
      const track = (): TrackListEntry => {
        const r = rng.next();
        if (r < 0.35) return rng.nextRange(50, 150);
        if (r < 0.7) return "auto";
        return "1fr";
      };
      node.gridTemplateColumns = Array.from(
        { length: rng.nextRange(2, 3) },
        track,
      );
      node.gridTemplateRows = Array.from(
        { length: rng.nextRange(2, 3) },
        track,
      );
      if (rng.next() < 0.7) node.gap = genGap(rng);
      if (rng.next() < 0.4) {
        node.justifyItems = rng.nextChoice([
          "start",
          "center",
          "stretch",
        ] as const);
      }
    } else {
      if (rng.next() < 0.7) {
        (node as any)._contentWidth = rng.nextRange(30, 200);
        (node as any)._contentHeight = rng.nextRange(20, 120);
      } else {
        if (rng.next() < 0.6) node.width = rng.nextRange(30, 130);
        if (rng.next() < 0.6) node.height = rng.nextRange(20, 90);
      }
    }
  } else if (tier === 26) {
    // Text-driven flex items: wrapped height depends on the resolved main size.
    // cat 0: row nowrap; cat 1: row wrap; cat 2: column; cat 3: row w/ min/max.
    const cat = tier26Config.category;
    if (depth > 0) {
      node.display = "flex";
      node.flexWrap = cat === 1 ? "wrap" : "nowrap";
      if (cat === 2) {
        node.flexDirection = "column";
        node.width = rng.nextRange(120, 320);
        if (rng.next() < 0.5) node.height = rng.nextRange(200, 480);
      } else {
        node.flexDirection = "row";
        node.width = rng.nextRange(180, 460);
        node.height = rng.nextRange(120, 360);
      }
      if (rng.next() < 0.5) node.gap = genGap(rng);
      if (rng.next() < 0.5) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
      if (rng.next() < 0.3) {
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "space-between",
        ] as const);
      }
    } else {
      isLeaf = true;
      if (rng.next() < 0.75) {
        (node as any)._text = genTextString(rng, 2, 10);
        node.flexGrow = rng.nextChoice([0, 0, 1, 2] as const);
        node.flexShrink = rng.nextChoice([0, 1, 1] as const);
        if (cat === 3) {
          if (rng.next() < 0.5) node.flexBasis = rng.nextRange(30, 120);
          if (rng.next() < 0.5) node.minWidth = rng.nextRange(20, 80);
          if (rng.next() < 0.4) node.maxWidth = rng.nextRange(120, 260);
        } else if (rng.next() < 0.3) {
          node.flexBasis =
            rng.next() < 0.5 ? ("content" as const) : rng.nextRange(30, 120);
        }
      } else {
        node.width = rng.nextRange(30, 140);
        node.height = rng.nextRange(20, 90);
        node.flexGrow = rng.nextChoice([0, 0, 1] as const);
        node.flexShrink = rng.nextChoice([0, 1] as const);
      }
    }
  } else if (tier === 27) {
    // Text-driven grid items: auto rows sized by wrapped text at the resolved
    // column width; fit-content vs stretched columns.
    const cat = tier27Config.category;
    if (depth > 0) {
      node.display = "grid";
      node.width = rng.nextRange(240, 620);
      if (rng.next() < 0.4) node.height = rng.nextRange(160, 460);
      const colTrack = (): TrackListEntry => {
        const r = rng.next();
        if (cat === 2) {
          // Emphasize fr / minmax columns.
          if (r < 0.5) return "1fr";
          if (r < 0.8) return { min: rng.nextRange(40, 90), max: "1fr" };
          return rng.nextRange(70, 160);
        }
        if (r < 0.45) return rng.nextRange(70, 170);
        if (r < 0.7) return "auto";
        if (r < 0.85) return "1fr";
        return { min: rng.nextRange(40, 90), max: rng.nextRange(120, 200) };
      };
      const rowTrack = (): TrackListEntry => {
        // Bias rows toward auto so wrapped-text height drives them.
        const r = rng.next();
        if (r < 0.7) return "auto";
        if (r < 0.85) return rng.nextRange(30, 70);
        return "min-content";
      };
      node.gridTemplateColumns = Array.from(
        { length: rng.nextRange(2, 3) },
        colTrack,
      );
      node.gridTemplateRows = Array.from(
        { length: rng.nextRange(1, 3) },
        rowTrack,
      );
      if (rng.next() < 0.7) node.gap = genGap(rng);
      if (rng.next() < 0.6) {
        node.justifyItems = rng.nextChoice([
          "start",
          "center",
          "stretch",
        ] as const);
      }
      if (rng.next() < 0.3) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "center",
          "stretch",
        ] as const);
      }
    } else {
      isLeaf = true;
      if (rng.next() < 0.8) {
        (node as any)._text = genTextString(rng, 2, 12);
      } else {
        node.width = rng.nextRange(40, 130);
        node.height = rng.nextRange(24, 90);
      }
    }
  } else if (tier === 28) {
    const cat = tier28Config.category;
    if (depth === 2) {
      node.display = "flex";
      node.flexDirection = cat === 1 ? "row" : "column";
      node.width = rng.nextRange(400, 900);
      node.height = rng.nextRange(300, 600);
      if (cat === 2) {
        node.alignItems = rng.nextChoice([
          "stretch",
          "flex-start",
          "center",
        ] as const);
      }
      if (rng.next() < 0.5) node.gap = genGap(rng);
    } else if (depth === 1) {
      node.display = "grid";
      const min = rng.nextRange(60, 140);
      node.gridTemplateColumns = [
        {
          repeat: rng.next() < 0.5 ? "auto-fill" : "auto-fit",
          tracks: [rng.next() < 0.6 ? { min, max: "1fr" as const } : min],
        },
      ];
      node.gridAutoRows = rng.nextRange(30, 80);
      if (rng.next() < 0.7) node.gap = genGap(rng);
      if (cat === 1) {
        node.flexGrow = rng.nextRange(0, 2);
        if (rng.next() < 0.5) node.height = rng.nextRange(120, 300);
      }
      if (cat === 2 && rng.next() < 0.5) {
        node.alignSelf = rng.nextChoice(["stretch", "flex-start"] as const);
      }
    } else {
      if (rng.next() < 0.4) node.width = rng.nextRange(30, 110);
      if (rng.next() < 0.4) node.height = rng.nextRange(20, 60);
    }
  } else if (tier === 29) {
    const cat = tier29Config.category;
    if (depth === 2) {
      if (cat === 0) {
        node.display = "grid";
        node.width = rng.nextRange(320, 760);
        if (rng.next() < 0.4) node.height = rng.nextRange(240, 520);
        node.gridTemplateColumns = Array.from(
          { length: rng.nextRange(2, 3) },
          (): TrackListEntry => {
            const r = rng.next();
            if (r < 0.4) return rng.nextRange(120, 240);
            if (r < 0.75) return "auto";
            return "1fr";
          },
        );
        node.gridTemplateRows = Array.from(
          { length: rng.nextRange(1, 2) },
          (): TrackListEntry => (rng.next() < 0.8 ? "auto" : rng.nextRange(60, 140)),
        );
        if (rng.next() < 0.7) node.gap = genGap(rng);
      } else {
        node.display = "flex";
        node.flexDirection = "column";
        node.width = rng.nextRange(320, 760);
        node.height = rng.nextRange(240, 560);
        if (rng.next() < 0.4) {
          node.alignItems = rng.nextChoice([
            "stretch",
            "flex-start",
            "center",
          ] as const);
        }
        if (rng.next() < 0.5) node.gap = genGap(rng);
      }
    } else if (depth === 1) {
      if (cat === 1) {
        node.display = "grid";
        node.gridTemplateColumns = Array.from(
          { length: rng.nextRange(1, 2) },
          (): TrackListEntry => (rng.next() < 0.5 ? "auto" : "1fr"),
        );
        node.gridTemplateRows = [
          rng.next() < 0.8 ? "auto" : rng.nextRange(50, 120),
        ] as TrackListEntry[];
        if (rng.next() < 0.5) node.gap = genGap(rng);
        if (rng.next() < 0.3) node.width = rng.nextRange(140, 300);
      } else {
        node.display = "flex";
        node.flexDirection = rng.next() < 0.6 ? "column" : "row";
        if (rng.next() < 0.3) node.width = rng.nextRange(140, 300);
        if (rng.next() < 0.2) node.height = rng.nextRange(80, 200);
        if (rng.next() < 0.5) node.gap = genGap(rng);
      }
    } else {
      isLeaf = true;
      if (rng.next() < 0.85) {
        (node as any)._text = genTextString(rng, 3, 14);
      } else {
        node.width = rng.nextRange(40, 120);
        node.height = rng.nextRange(20, 60);
      }
    }
  } else if (tier === 30) {
    const cat = tier30Config.category;
    if (depth === 2) {
      if (cat === 1) {
        node.display = "grid";
        node.width = rng.nextRange(320, 700);
        if (rng.next() < 0.5) node.height = rng.nextRange(240, 520);
        node.gridTemplateColumns = Array.from(
          { length: rng.nextRange(2, 3) },
          (): TrackListEntry => (rng.next() < 0.5 ? "auto" : "1fr"),
        );
        node.gridTemplateRows = ["auto"] as TrackListEntry[];
        if (rng.next() < 0.7) node.gap = genGap(rng);
      } else {
        node.display = "flex";
        node.flexDirection = cat === 2 ? "row" : "column";
        node.width = rng.nextRange(320, 700);
        node.height = rng.nextRange(240, 560);
        if (cat === 2 && rng.next() < 0.6) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "center",
            "stretch",
          ] as const);
        }
        if (rng.next() < 0.5) node.gap = genGap(rng);
      }
    } else if (depth === 1) {
      node.display = "flex";
      node.flexWrap = rng.next() < 0.8 ? "wrap" : "wrap-reverse";
      if (rng.next() < 0.3) node.width = rng.nextRange(140, 280);
      if (rng.next() < 0.6) node.gap = genGap(rng);
      if (cat === 2 && rng.next() < 0.4) node.flexGrow = rng.nextRange(0, 2);
    } else {
      isLeaf = true;
      node.width = rng.nextRange(40, 130);
      node.height = rng.nextRange(20, 60);
    }
  } else if (tier === 7) {
    if (depth === 2) {
      // Root flex container — definite sizes
      node.display = "flex";
      node.flexDirection = rng.nextChoice(["row", "column"] as const);
      node.flexWrap = "nowrap";
      node.width = rng.nextRange(400, 800);
      node.height = rng.nextRange(300, 600);
      if (rng.next() < 0.5) {
        node.alignItems = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
      if (rng.next() < 0.3) {
        node.justifyContent = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "space-between",
        ] as const);
      }
    } else if (depth === 1) {
      // Mix of nested flex containers and leaf items
      const isNestedFlex = rng.next() < 0.65;
      if (isNestedFlex) {
        // Nested flex container (also a flex item of the root)
        node.display = "flex";
        node.flexDirection = rng.nextChoice(["row", "column"] as const);
        node.flexWrap = "nowrap";
        // Some have definite width, some auto
        if (rng.next() < 0.5) {
          node.width = rng.nextRange(80, 250);
        }
        // Some have definite height, some auto
        if (rng.next() < 0.4) {
          node.height = rng.nextRange(60, 200);
        }
        // Flex item properties (of the parent container)
        node.flexGrow = rng.nextRange(0, 2);
        node.flexShrink = rng.nextChoice([0, 1, 1]);
        if (rng.next() < 0.4) {
          node.flexBasis = rng.nextRange(50, 200);
        }
        if (rng.next() < 0.3) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
        if (rng.next() < 0.2) {
          node.alignSelf = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
      } else {
        // Leaf item (no children)
        isLeaf = true;
        node.width = rng.nextRange(40, 150);
        node.height = rng.nextRange(30, 120);
        node.flexGrow = rng.nextRange(0, 2);
        node.flexShrink = rng.nextChoice([0, 1]);
        node.flexBasis = rng.nextChoice([0, rng.nextRange(20, 80)]);
      }
    } else {
      // depth === 0: leaf items inside nested flex containers
      if (rng.next() < 0.7) {
        node.width = rng.nextRange(20, 100);
      }
      if (rng.next() < 0.7) {
        node.height = rng.nextRange(20, 80);
      }
      node.flexGrow = rng.nextRange(0, 2);
      node.flexShrink = rng.nextChoice([0, 1]);
      if (rng.next() < 0.4) {
        node.flexBasis = rng.nextRange(10, 60);
      }
      if (rng.next() < 0.2) {
        node.alignSelf = rng.nextChoice([
          "flex-start",
          "flex-end",
          "center",
          "stretch",
        ] as const);
      }
    }
  } else if (tier === 31) {
    const cat = tier31Config.category;
    if (depth > 0) {
      if (cat === 1) {
        // Grid container with align-content: space-evenly
        node.display = "grid";
        node.width = rng.nextRange(250, 600);
        if (rng.next() < 0.8) node.height = rng.nextRange(150, 500);
        node.gridTemplateColumns = Array.from(
          { length: rng.nextRange(2, 3) },
          (): TrackListEntry => {
            const r = rng.next();
            return r < 0.4 ? rng.nextRange(60, 160) : r < 0.7 ? "auto" : "1fr";
          },
        );
        node.gridTemplateRows = Array.from(
          { length: rng.nextRange(2, 3) },
          (): TrackListEntry =>
            rng.next() < 0.7 ? rng.nextRange(40, 120) : "auto",
        );
        node.alignContent = "space-evenly";
        if (rng.next() < 0.6) {
          node.justifyContent = rng.nextChoice([
            "flex-start",
            "center",
            "space-between",
            "space-around",
            "space-evenly",
          ] as const);
        }
        if (rng.next() < 0.5) node.gap = genGap(rng);
      } else {
        // Wrapping flex container with align-content: space-evenly;
        // sizes chosen so free cross space is positive or negative
        node.display = "flex";
        node.flexDirection =
          cat === 2
            ? rng.nextChoice(["column", "column", "row"] as const)
            : rng.nextChoice(["row", "column"] as const);
        node.flexWrap = rng.nextChoice(["wrap", "wrap-reverse"] as const);
        node.width = rng.nextRange(200, 400);
        node.height = rng.nextRange(150, 400);
        node.alignContent = "space-evenly";
        if (rng.next() < 0.5) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
        if (cat === 2 || rng.next() < 0.3) node.gap = genGap(rng);
      }
    } else {
      node.width = rng.nextRange(40, 150);
      node.height = rng.nextRange(30, 100);
      node.flexGrow = rng.nextChoice([0, 0, 1]);
      node.flexShrink = rng.nextChoice([0, 0, 1]);
      if (rng.next() < 0.25) {
        delete (node as any).height;
      }
    }
  } else if (tier === 32) {
    const cat = tier32Config.category;
    if (depth > 0) {
      if (cat === 3) {
        // Grid with fixed px tracks; ratio items place into definite cells
        node.display = "grid";
        node.width = rng.nextRange(300, 640);
        node.height = rng.nextRange(200, 480);
        node.gridTemplateColumns = Array.from(
          { length: rng.nextRange(2, 3) },
          (): TrackListEntry => rng.nextRange(70, 160),
        );
        node.gridTemplateRows = Array.from(
          { length: rng.nextRange(2, 3) },
          (): TrackListEntry => rng.nextRange(50, 130),
        );
        // Ratio items in implicit (auto) tracks are out of vocabulary; cap
        // children at the explicit cell count.
        tier32Config.cells =
          node.gridTemplateColumns.length * node.gridTemplateRows.length;
        if (rng.next() < 0.5) node.gap = genGap(rng);
        if (rng.next() < 0.4) {
          node.justifyItems = rng.nextChoice([
            "start",
            "end",
            "center",
            "stretch",
          ] as const);
        }
        if (rng.next() < 0.4) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
      } else {
        const dir = rng.nextChoice(["row", "column"] as const);
        tier32Config.dir = dir;
        node.display = "flex";
        node.flexDirection = dir;
        node.flexWrap =
          cat === 2
            ? rng.nextChoice(["wrap", "wrap-reverse"] as const)
            : "nowrap";
        node.width = rng.nextRange(250, 550);
        if (cat === 2 || rng.next() < 0.8) {
          node.height = rng.nextRange(150, 400);
        }
        if (rng.next() < 0.5) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
        if (cat === 2) {
          node.alignContent = rng.nextChoice([
            "flex-start",
            "center",
            "stretch",
            "space-between",
            "space-around",
            "space-evenly",
          ] as const);
        }
        if (rng.next() < 0.3) node.gap = genGap(rng);
      }
    } else {
      node.aspectRatio = rng.nextChoice([0.5, 0.75, 1, 1.5, 2, 3] as const);
      const isRowDir = tier32Config.dir === "row";
      if (cat === 3) {
        const mode = rng.next();
        if (mode < 0.25) {
          node.width = rng.nextRange(40, 140);
        } else if (mode < 0.5) {
          node.height = rng.nextRange(30, 110);
        }
        if (rng.next() < 0.5) {
          node.justifySelf = rng.nextChoice([
            "start",
            "end",
            "center",
            "stretch",
          ] as const);
        }
        if (rng.next() < 0.5) {
          node.alignSelf = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
      } else if (cat === 2) {
        // Wrap needs a definite main size for stable line breaking
        if (isRowDir) {
          node.width = rng.nextRange(60, 180);
        } else {
          node.height = rng.nextRange(40, 140);
        }
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
      } else {
        const mode = rng.next();
        if (mode < 0.3) {
          if (isRowDir) node.height = rng.nextRange(30, 120);
          else node.width = rng.nextRange(40, 140);
        } else if (mode < 0.55) {
          if (isRowDir) node.width = rng.nextRange(40, 140);
          else node.height = rng.nextRange(30, 120);
        } else if (mode < 0.65) {
          node.width = rng.nextRange(40, 140);
          node.height = rng.nextRange(30, 120);
        }
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1, 1]);
        if (rng.next() < 0.35) {
          node.alignSelf = rng.nextChoice([
            "flex-start",
            "flex-end",
            "center",
            "stretch",
          ] as const);
        }
        if (cat === 1) {
          const axis = rng.next();
          if (axis < 0.25) node.minWidth = rng.nextRange(30, 200);
          else if (axis < 0.5) node.maxWidth = rng.nextRange(30, 200);
          else if (axis < 0.75) node.minHeight = rng.nextRange(30, 180);
          else node.maxHeight = rng.nextRange(30, 180);
        }
      }
      if (rng.next() < 0.3) {
        const p = rng.nextRange(2, 14);
        node.padding = { top: p, right: p, bottom: p, left: p };
      }
      if (rng.next() < 0.25) {
        const b = rng.nextRange(1, 6);
        node.border = { top: b, right: b, bottom: b, left: b };
      }
      node.boxSizing = rng.next() < 0.5 ? "border-box" : "content-box";
    }
  } else if (tier === 33) {
    const cat = tier33Config.category;
    if (depth === 2) {
      if (cat === 2 || cat === 3) {
        node.display = "grid";
        node.width = rng.nextRange(300, 700);
        node.height = rng.nextRange(200, 500);
        const fitTrack = (): TrackListEntry => ({
          fitContent: rng.nextRange(60, 250),
        });
        const otherTrack = (): TrackListEntry => {
          const r = rng.next();
          return r < 0.5 ? rng.nextRange(60, 150) : r < 0.75 ? "auto" : "1fr";
        };
        if (cat === 2) {
          node.gridTemplateColumns = Array.from(
            { length: rng.nextRange(2, 3) },
            () => (rng.next() < 0.6 ? fitTrack() : otherTrack()),
          );
          node.gridTemplateRows = Array.from(
            { length: rng.nextRange(1, 2) },
            (): TrackListEntry => rng.nextRange(60, 140),
          );
        } else {
          node.gridTemplateColumns = Array.from(
            { length: 2 },
            (): TrackListEntry => rng.nextRange(80, 160),
          );
          node.gridTemplateRows = Array.from(
            { length: rng.nextRange(2, 3) },
            () =>
              rng.next() < 0.6
                ? ({ fitContent: rng.nextRange(40, 160) } as TrackListEntry)
                : rng.next() < 0.5
                  ? (rng.nextRange(50, 120) as TrackListEntry)
                  : ("auto" as TrackListEntry),
          );
        }
        if (rng.next() < 0.5) node.gap = genGap(rng);
      } else {
        const dir = rng.nextChoice(["row", "column"] as const);
        tier33Config.dir = dir;
        node.display = "flex";
        node.flexDirection = dir;
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(200, 600);
        node.height = rng.nextRange(150, 450);
        if (rng.next() < 0.5) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "center",
            "stretch",
          ] as const);
        }
        if (rng.next() < 0.3) node.gap = genGap(rng);
      }
    } else if (depth === 1) {
      node.display = "flex";
      if (cat === 0) {
        node.width = "fit-content";
        node.flexDirection = "row";
        if (rng.next() < 0.5) node.flexWrap = "wrap";
        if (rng.next() < 0.4) node.height = rng.nextRange(40, 120);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
      } else if (cat === 1) {
        node.height = "fit-content";
        node.flexDirection = "column";
        if (rng.next() < 0.5) node.width = rng.nextRange(60, 160);
        node.flexGrow = rng.nextChoice([0, 0, 1]);
        node.flexShrink = rng.nextChoice([0, 1]);
      } else if (cat === 2) {
        node.flexDirection = "row";
        if (rng.next() < 0.6) node.flexWrap = "wrap";
      } else {
        node.flexDirection = "column";
      }
      if (rng.next() < 0.3) {
        const p = rng.nextRange(2, 12);
        node.padding = { top: p, right: p, bottom: p, left: p };
      }
      if (rng.next() < 0.4) {
        node.boxSizing = rng.next() < 0.5 ? "border-box" : "content-box";
      }
    } else {
      node.width = rng.nextRange(30, 90);
      node.height = rng.nextRange(20, 60);
      node.flexShrink = rng.nextChoice([0, 0, 1]);
    }
  } else if (tier === 34) {
    const cat = tier34Config.category;
    if (depth === 2) {
      if (cat === 3) {
        node.display = "grid";
        node.width = rng.nextRange(300, 640);
        node.height = rng.nextRange(220, 480);
        node.gridTemplateColumns = Array.from(
          { length: 2 },
          (): TrackListEntry => rng.nextRange(120, 260),
        );
        node.gridTemplateRows = Array.from(
          { length: rng.nextRange(1, 2) },
          (): TrackListEntry => rng.nextRange(90, 200),
        );
        if (rng.next() < 0.4) node.gap = genGap(rng);
      } else {
        node.display = "flex";
        node.flexDirection = cat === 0 ? "row" : "column";
        node.flexWrap = "nowrap";
        node.width = rng.nextRange(250, 550);
        node.height = rng.nextRange(200, 450);
        if (rng.next() < 0.4) {
          node.alignItems = rng.nextChoice([
            "flex-start",
            "center",
            "stretch",
          ] as const);
        }
        if (rng.next() < 0.3) node.gap = genGap(rng);
      }
    } else if (depth === 1) {
      node.display = "flex";
      const keywordChoice = rng.nextChoice([
        "min-content",
        "max-content",
      ] as const);
      if (cat === 0) {
        node.flexDirection = "row";
        if (rng.next() < 0.5) node.flexWrap = "wrap";
        const mode = rng.next();
        if (mode < 0.35) {
          node.maxWidth = keywordChoice;
          node.flexGrow = 1;
        } else if (mode < 0.6) {
          node.minWidth = "max-content";
          if (rng.next() < 0.6) node.width = rng.nextRange(30, 80);
          node.flexShrink = rng.nextChoice([0, 1]);
        } else {
          node.minWidth = keywordChoice;
          node.flexShrink = 1;
        }
      } else if (cat === 1) {
        node.flexDirection = "column";
        const mode = rng.next();
        if (mode < 0.4) {
          node.maxHeight = keywordChoice;
          node.flexGrow = rng.nextChoice([0, 1]);
        } else if (mode < 0.7) {
          node.minHeight = "max-content";
          if (rng.next() < 0.6) node.height = rng.nextRange(20, 60);
        } else {
          node.minHeight = "min-content";
          node.flexShrink = 1;
        }
      } else if (cat === 2) {
        node.flexDirection = "row";
        if (rng.next() < 0.5) node.flexWrap = "wrap";
        const mode = rng.next();
        if (mode < 0.5) {
          node.maxWidth = keywordChoice;
        } else {
          node.minWidth = "max-content";
          if (rng.next() < 0.5) node.width = rng.nextRange(30, 80);
        }
        if (rng.next() < 0.4) {
          node.alignSelf = rng.nextChoice([
            "flex-start",
            "center",
            "stretch",
          ] as const);
        }
      } else {
        // Keyword heights only on column children: row-wrap heights are
        // width-dependent and outside the static keyword resolution.
        node.flexDirection = rng.next() < 0.6 ? "row" : "column";
        if (node.flexDirection === "row" && rng.next() < 0.5)
          node.flexWrap = "wrap";
        if (node.flexDirection === "row" || rng.next() < 0.5) {
          if (rng.next() < 0.5) node.maxWidth = keywordChoice;
          else node.minWidth = "max-content";
        } else {
          if (rng.next() < 0.5) node.maxHeight = keywordChoice;
          else node.minHeight = "max-content";
        }
        if (rng.next() < 0.4) {
          node.justifySelf = rng.nextChoice([
            "start",
            "center",
            "stretch",
          ] as const);
        }
      }
      if (rng.next() < 0.3) {
        const p = rng.nextRange(2, 12);
        node.padding = { top: p, right: p, bottom: p, left: p };
      }
      if (rng.next() < 0.4) {
        node.boxSizing = rng.next() < 0.5 ? "border-box" : "content-box";
      }
    } else {
      node.width = rng.nextRange(30, 90);
      node.height = rng.nextRange(20, 60);
      node.flexShrink = rng.nextChoice([0, 0, 1]);
    }
  }

  if (depth > 0 && !isLeaf) {
    const numChildren =
      tier === 7
        ? depth === 2
          ? rng.nextRange(2, 5)
          : rng.nextRange(2, 4)
        : tier === 6
          ? rng.nextRange(4, 8)
          : tier === 9
            ? rng.nextRange(3, 6)
            : tier === 10
              ? tier10Config.category === 1
                ? rng.nextRange(1, 2) // deep nesting: 1-2 per level
                : rng.nextRange(3, 6) // other categories: 3-6 items
              : tier === 11
                ? rng.nextRange(3, 6) // mix of in-flow and absolute children
                : tier === 12
                  ? depth === 2
                    ? rng.nextRange(2, 4) // intermediates
                    : rng.nextRange(2, 4) // mix of fixed/abs/in-flow leaves
                  : tier === 13
                    ? tier13Config.category === 2 || tier13Config.category === 3
                      ? rng.nextRange(4, 8) // enough items to force wrapping
                      : tier13Config.category === 5
                        ? rng.nextRange(2, 4)
                        : rng.nextRange(2, 5)
                    : tier === 15
                      ? tier15Config.category === 2
                        ? rng.nextRange(4, 8)
                        : rng.nextRange(3, 6)
                    : tier === 16
                      ? rng.nextRange(2, 5)
                    : tier >= 18 && tier <= 20
                      ? rng.nextRange(2, 4)
                    : tier === 21
                      ? [1, 3, 4].includes(tier21Config.category)
                        ? rng.nextRange(4, 8)
                        : rng.nextRange(2, 4)
                    : tier === 22
                      ? tier22Config.category === 3
                        ? rng.nextRange(4, 8)
                        : rng.nextRange(3, 6)
                    : tier === 23
                      ? rng.nextRange(2, 4)
                    : tier === 24
                      ? rng.nextRange(2, 8)
                    : tier === 25
                      ? rng.nextRange(3, 6)
                    : tier === 26
                      ? rng.nextRange(2, 6)
                    : tier === 27
                      ? rng.nextRange(2, 6)
                    : tier === 28
                      ? depth === 2
                        ? rng.nextRange(1, 3)
                        : rng.nextRange(3, 8)
                    : tier === 29
                      ? depth === 2
                        ? rng.nextRange(2, 3)
                        : rng.nextRange(1, 3)
                    : tier === 30
                      ? depth === 2
                        ? rng.nextRange(1, 3)
                        : rng.nextRange(4, 10)
                    : tier === 31
                      ? tier31Config.category === 1
                        ? rng.nextRange(3, 6)
                        : rng.nextRange(4, 8)
                    : tier === 32
                      ? tier32Config.category === 2
                        ? rng.nextRange(4, 8)
                        : tier32Config.category === 3
                          ? Math.min(rng.nextRange(3, 6), tier32Config.cells)
                          : rng.nextRange(2, 4)
                    : tier === 33
                      ? depth === 2
                        ? rng.nextRange(2, 3)
                        : rng.nextRange(2, 5)
                    : tier === 34
                      ? depth === 2
                        ? rng.nextRange(2, 3)
                        : rng.nextRange(2, 5)
                    : (tier >= 2 && tier <= 5) || tier === 14
                  ? rng.nextRange(2, 5)
                  : rng.nextRange(1, 3);
    for (let i = 0; i < numChildren; i++) {
      node.children.push(genNode(rng, depth - 1, tier));
    }
    if (tier >= 18 && tier <= 20 && node.display === "grid") {
      assignGridPlacements(node, rng, tier === 18 && tier18Config.category === 2);
    }
    if (tier === 21 && node.display === "grid") {
      assignTier21Placements(node, rng, tier21Config.category);
    }
    if (tier === 22 && node.display === "grid") {
      if (tier22Config.category === 3) {
        assignTier21Placements(node, rng, 4);
      } else if (rng.next() < 0.5) {
        assignGridPlacements(node, rng, false);
      }
    }
    if (tier === 23 && node.display === "grid" && rng.next() < 0.5) {
      assignGridPlacements(node, rng, false);
    }
    if (tier === 25 && node.display === "grid" && rng.next() < 0.5) {
      assignGridPlacements(node, rng, false);
    }
    if (tier === 24 && node.display === "grid" && tier24Config.category === 2) {
      for (const child of node.children) {
        if (rng.next() < 0.3) {
          child.gridColumn = { start: rng.nextRange(1, 4), end: "auto" };
          child.gridRow = { start: rng.nextRange(1, 2), end: "auto" };
        }
      }
    }
  }

  return node;
}

function toHTML(node: GenNode): string {
  const styles: string[] = [
    node.width !== undefined
      ? `width: ${node.width}${typeof node.width === "number" ? "px" : ""}`
      : "",
    node.height !== undefined
      ? `height: ${node.height}${typeof node.height === "number" ? "px" : ""}`
      : "",
    `padding: ${node.padding.top}px ${node.padding.right}px ${node.padding.bottom}px ${node.padding.left}px`,
    `margin: ${node.margin.top === "auto" ? "auto" : node.margin.top + "px"} ${node.margin.right === "auto" ? "auto" : node.margin.right + "px"} ${node.margin.bottom === "auto" ? "auto" : node.margin.bottom + "px"} ${node.margin.left === "auto" ? "auto" : node.margin.left + "px"}`,
    `border-width: ${node.border.top}px ${node.border.right}px ${node.border.bottom}px ${node.border.left}px`,
    `border-style: solid`,
    `border-color: black`,
    `box-sizing: ${node.boxSizing}`,
    `display: ${node.display}`,
  ].filter(Boolean);

  if (node.display === "flex" || node.display === "grid") {
    if (node.alignItems) styles.push(`align-items: ${node.alignItems}`);
    if (node.justifyContent)
      styles.push(`justify-content: ${node.justifyContent}`);
    if (node.alignContent) styles.push(`align-content: ${node.alignContent}`);
    if (node.gap !== undefined)
      styles.push(
        typeof node.gap === "number"
          ? `gap: ${node.gap}px`
          : `gap: ${node.gap.row}px ${node.gap.column}px`,
      );
  }
  if (node.display === "flex") {
    if (node.flexDirection)
      styles.push(`flex-direction: ${node.flexDirection}`);
    if (node.flexWrap) styles.push(`flex-wrap: ${node.flexWrap}`);
  }
  styles.push(...gridStyleDeclarations(node));

  if (node.alignSelf && node.alignSelf !== "auto")
    styles.push(`align-self: ${node.alignSelf}`);

  if (node.flexGrow !== undefined) styles.push(`flex-grow: ${node.flexGrow}`);
  if (node.flexShrink !== undefined)
    styles.push(`flex-shrink: ${node.flexShrink}`);
  if (node.flexBasis !== undefined) {
    const basis =
      typeof node.flexBasis === "number"
        ? `${node.flexBasis}px`
        : node.flexBasis;
    styles.push(`flex-basis: ${basis}`);
  }
  if (node.order !== undefined) styles.push(`order: ${node.order}`);
  if (node.aspectRatio !== undefined)
    styles.push(`aspect-ratio: ${node.aspectRatio}`);
  const mm = (v: number | string) => (typeof v === "number" ? `${v}px` : v);
  if (node.minWidth !== undefined)
    styles.push(`min-width: ${mm(node.minWidth)}`);
  if (node.maxWidth !== undefined)
    styles.push(`max-width: ${mm(node.maxWidth)}`);
  if (node.minHeight !== undefined)
    styles.push(`min-height: ${mm(node.minHeight)}`);
  if (node.maxHeight !== undefined)
    styles.push(`max-height: ${mm(node.maxHeight)}`);
  if (node.position && node.position !== "static")
    styles.push(`position: ${node.position}`);
  if (node.top !== undefined) styles.push(`top: ${node.top}px`);
  if (node.right !== undefined) styles.push(`right: ${node.right}px`);
  if (node.bottom !== undefined) styles.push(`bottom: ${node.bottom}px`);
  if (node.left !== undefined) styles.push(`left: ${node.left}px`);

  if ((node as any)._text !== undefined) {
    styles.push(
      `font: ${TEXT_FONT}`,
      `line-height: ${TEXT_LINE_HEIGHT}px`,
      `overflow-wrap: normal`,
      `word-break: normal`,
      `white-space: normal`,
      `hyphens: none`,
    );
  }

  let childrenHtml = node.children.map(toHTML).join("\n");
  // For content items, inject a fixed-size span as intrinsic content
  if ((node as any)._contentWidth !== undefined) {
    childrenHtml += `<span style="display:block; width:${(node as any)._contentWidth}px; height:${(node as any)._contentHeight}px;"></span>`;
  }
  if ((node as any)._text !== undefined) {
    childrenHtml += (node as any)._text;
  }
  return `<div id="${node.id}" style="${styles.join("; ")}">${childrenHtml}</div>`;
}

async function generateFixtures(
  browser: Browser,
  tier: number,
  count: number,
  fixturesDir: string,
) {
  const page = await browser.newPage();
  const version = await browser.version();

  console.log(`Generating ${count} fixtures for Tier ${tier}...`);

  for (let i = 0; i < count; i++) {
    const seed = tier * 10000 + i;
    const rng = new RNG(seed);
    idCounter = 1;

    // Configure tier 10 per-fixture before calling genNode
    if (tier === 10) {
      tier10Config.category = i % 6;
      tier10Config.maxDepth = tier10Config.category === 1 ? 5 : 1;
    }
    if (tier === 13) {
      tier13Config.category = i % 6;
    }
    if (tier === 15) {
      tier15Config.category = i % 6;
    }
    if (tier === 16) {
      tier16Config.category = i % 6;
    }
    if (tier === 17) {
      tier17Config.category = i % 3;
    }
    if (tier === 18) {
      tier18Config.category = i % 5;
    }
    if (tier === 19) {
      tier19Config.category = i % 5;
    }
    if (tier === 20) {
      tier20Config.category = i % 5;
    }
    if (tier === 21) {
      tier21Config.category = i % 5;
    }
    if (tier === 22) {
      tier22Config.category = i % 5;
    }
    if (tier === 23) {
      tier23Config.category = i % 3;
    }
    if (tier === 24) {
      tier24Config.category = i % 4;
    }
    if (tier === 26) {
      tier26Config.category = i % 4;
    }
    if (tier === 27) {
      tier27Config.category = i % 3;
    }
    if (tier === 28) {
      tier28Config.category = i % 3;
    }
    if (tier === 29) {
      tier29Config.category = i % 3;
    }
    if (tier === 30) {
      tier30Config.category = i % 3;
    }
    if (tier === 31) {
      tier31Config.category = i % 3;
    }
    if (tier === 32) {
      tier32Config.category = i % 4;
    }
    if (tier === 33) {
      tier33Config.category = i % 4;
    }
    if (tier === 34) {
      tier34Config.category = i % 4;
    }

    const depth =
      tier === 7 || tier === 12
        ? 2
        : tier === 10
          ? tier10Config.maxDepth
          : tier === 13
            ? tier13Config.category === 5
              ? 2
              : 1
            : tier === 15
              ? tier15Config.category === 4
                ? 2
                : 1
            : tier === 16
              ? tier16Config.category === 3
                ? 2
                : 1
            : tier === 17
              ? 3
            : (tier >= 18 && tier <= 22) ||
                tier === 24 ||
                tier === 25 ||
                tier === 26 ||
                tier === 27 ||
                tier === 31 ||
                tier === 32
              ? 1
            : tier === 23 || tier === 28 || tier === 29 || tier === 30 ||
                tier === 33 || tier === 34
              ? 2
            : (tier >= 2 && tier <= 6) ||
                tier === 8 ||
                tier === 9 ||
                tier === 11 ||
                tier === 14
              ? 1
              : 2;

    const tree = genNode(rng, depth, tier);

    // For test stability, position root container absolutely at 0,0
    // to avoid body margins affecting things (even though we reset them)
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; padding: 0; }
          #root-node { position: absolute; left: 0; top: 0; }
        </style>
      </head>
      <body>
        ${toHTML(tree)}
      </body>
      </html>
    `;

    await page.setContent(html);

    // tsx's esbuild keepNames transform injects __name() calls into serialized
    // evaluate callbacks; the helper doesn't exist in the page context.
    await page.evaluate("globalThis.__name = globalThis.__name || ((f) => f);");

    const expected = await page.evaluate(() => {
      const rootEl = document.getElementById("root-node")!;
      const rootRect = rootEl.getBoundingClientRect();
      const rootStyle = window.getComputedStyle(rootEl);
      const rootOriginX =
        rootRect.left +
        parseFloat(rootStyle.borderLeftWidth) +
        parseFloat(rootStyle.paddingLeft);
      const rootOriginY =
        rootRect.top +
        parseFloat(rootStyle.borderTopWidth) +
        parseFloat(rootStyle.paddingTop);

      const boxes: Record<string, any> = {};
      const elements = document.querySelectorAll("div");

      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        // Skip display:none elements — they don't participate in layout
        if (style.display === "none") return;

        const parse = (val: string) => parseFloat(val) || 0;

        const borderTop = parse(style.borderTopWidth);
        const borderRight = parse(style.borderRightWidth);
        const borderBottom = parse(style.borderBottomWidth);
        const borderLeft = parse(style.borderLeftWidth);

        const paddingTop = parse(style.paddingTop);
        const paddingRight = parse(style.paddingRight);
        const paddingBottom = parse(style.paddingBottom);
        const paddingLeft = parse(style.paddingLeft);

        const marginTop = parse(style.marginTop);
        const marginRight = parse(style.marginRight);
        const marginBottom = parse(style.marginBottom);
        const marginLeft = parse(style.marginLeft);

        const borderBoxWidth = rect.width;
        const borderBoxHeight = rect.height;

        const width =
          borderBoxWidth -
          borderLeft -
          borderRight -
          paddingLeft -
          paddingRight;
        const height =
          borderBoxHeight -
          borderTop -
          borderBottom -
          paddingTop -
          paddingBottom;

        const outerWidth = borderBoxWidth + marginLeft + marginRight;
        const outerHeight = borderBoxHeight + marginTop + marginBottom;

        const x = rect.left - rootOriginX;
        const y = rect.top - rootOriginY;

        boxes[el.id] = {
          id: el.id,
          x,
          y,
          width,
          height,
          padding: {
            top: paddingTop,
            right: paddingRight,
            bottom: paddingBottom,
            left: paddingLeft,
          },
          border: {
            top: borderTop,
            right: borderRight,
            bottom: borderBottom,
            left: borderLeft,
          },
          margin: {
            top: marginTop,
            right: marginRight,
            bottom: marginBottom,
            left: marginLeft,
          },
          borderBoxWidth,
          borderBoxHeight,
          outerWidth,
          outerHeight,
        };
      });

      return boxes;
    });

    // Capture per-word advance widths for text items directly from Chromium,
    // so the runner's line breaker is a pure function of measured data.
    const textItemList: { id: string; text: string }[] = [];
    function collectTextItems(n: any) {
      if (n._text !== undefined) textItemList.push({ id: n.id, text: n._text });
      if (n.children) for (const child of n.children) collectTextItems(child);
    }
    collectTextItems(tree);

    let textMeasurements: Record<
      string,
      { wordWidths: number[]; spaceWidth: number; lineHeight: number }
    > = {};
    if (textItemList.length > 0) {
      textMeasurements = await page.evaluate((items, font) => {
        const cv = document.createElement("canvas");
        const ctx = cv.getContext("2d")!;
        ctx.font = font;
        const spaceWidth =
          ctx.measureText("x x").width - ctx.measureText("xx").width;
        const out: Record<string, any> = {};
        for (const { id, text } of items) {
          const el = document.getElementById(id)!;
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
          out[id] = {
            wordWidths: text.split(" ").map((w) => ctx.measureText(w).width),
            spaceWidth,
            lineHeight,
          };
        }
        return out;
      }, textItemList, TEXT_FONT);
    }

    // Extract contentMeasurements and strip internal fields from the tree
    const contentMeasurements: Record<
      string,
      { width: number; height: number }
    > = {};
    function extractContentMeasurements(n: any) {
      if (n._contentWidth !== undefined) {
        contentMeasurements[n.id] = {
          width: n._contentWidth,
          height: n._contentHeight,
        };
        delete n._contentWidth;
        delete n._contentHeight;
      }
      if (n._text !== undefined) delete n._text;
      if (n.children) {
        for (const child of n.children) extractContentMeasurements(child);
      }
    }
    extractContentMeasurements(tree);

    const fixture: any = {
      tier,
      seed,
      description: `Tier ${tier} randomly generated fixture (seed ${seed})`,
      input: tree,
      expected,
      chromiumVersion: version,
      tolerance: 0.5,
    };

    if (Object.keys(contentMeasurements).length > 0) {
      fixture.contentMeasurements = contentMeasurements;
    }
    if (Object.keys(textMeasurements).length > 0) {
      fixture.textMeasurements = textMeasurements;
    }

    const filePath = path.join(fixturesDir, `tier-${tier}-${seed}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));
  }

  await page.close();
}

async function run() {
  const fixturesDir = path.join(import.meta.dirname, "..", "fixtures");
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({ headless: true });

  const args = process.argv.slice(2);
  let tierArg = null;
  let countArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tier") tierArg = parseInt(args[++i], 10);
    if (args[i] === "--count") countArg = parseInt(args[++i], 10);
  }

  const tasks = [];
  if (tierArg) {
    tasks.push({
      tier: tierArg,
      count: countArg || (tierArg === 1 ? 50 : 100),
    });
  } else {
    tasks.push({ tier: 1, count: 50 });
    tasks.push({ tier: 2, count: 100 });
    tasks.push({ tier: 3, count: 150 });
    tasks.push({ tier: 4, count: 100 });
    tasks.push({ tier: 5, count: 75 });
    tasks.push({ tier: 6, count: 150 });
    tasks.push({ tier: 7, count: 200 });
    tasks.push({ tier: 8, count: 100 });
    tasks.push({ tier: 9, count: 50 });
    tasks.push({ tier: 10, count: 200 });
  }

  for (const task of tasks) {
    await generateFixtures(browser, task.tier, task.count, fixturesDir);
  }

  await browser.close();
  console.log("Done.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
