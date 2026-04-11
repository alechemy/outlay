import * as fs from "fs";
import * as path from "path";
import puppeteer, { Browser } from "puppeteer";
import { LayoutNode } from "../src/types";

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

function genNode(rng: RNG, depth: number, tier: number): LayoutNode {
  const id = idCounter === 1 ? "root-node" : `node-${idCounter}`;
  idCounter++;

  let isLeaf = false; // Set to true for items that should have no children despite depth > 0

  const padding = genBoxSides(rng, 20);
  const margin = genBoxSides(rng, 20);
  const border = genBoxSides(rng, 10);
  const boxSizing = rng.nextChoice(["content-box", "border-box"] as const);

  const node: LayoutNode = {
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
              : tier >= 2 && tier <= 5
                ? rng.nextRange(2, 5)
                : rng.nextRange(1, 3);
    for (let i = 0; i < numChildren; i++) {
      node.children.push(genNode(rng, depth - 1, tier));
    }
  }

  return node;
}

function toHTML(node: LayoutNode): string {
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

  if (node.display === "flex") {
    if (node.flexDirection)
      styles.push(`flex-direction: ${node.flexDirection}`);
    if (node.flexWrap) styles.push(`flex-wrap: ${node.flexWrap}`);
    if (node.alignItems) styles.push(`align-items: ${node.alignItems}`);
    if (node.justifyContent)
      styles.push(`justify-content: ${node.justifyContent}`);
    if (node.alignContent) styles.push(`align-content: ${node.alignContent}`);
  }

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
  if (node.minWidth !== undefined) styles.push(`min-width: ${node.minWidth}px`);
  if (node.maxWidth !== undefined) styles.push(`max-width: ${node.maxWidth}px`);
  if (node.minHeight !== undefined)
    styles.push(`min-height: ${node.minHeight}px`);
  if (node.maxHeight !== undefined)
    styles.push(`max-height: ${node.maxHeight}px`);

  let childrenHtml = node.children.map(toHTML).join("\n");
  // For content items, inject a fixed-size span as intrinsic content
  if ((node as any)._contentWidth !== undefined) {
    childrenHtml += `<span style="display:block; width:${(node as any)._contentWidth}px; height:${(node as any)._contentHeight}px;"></span>`;
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

    const depth =
      tier === 7
        ? 2
        : tier === 10
          ? tier10Config.maxDepth
          : (tier >= 2 && tier <= 6) || tier === 8 || tier === 9
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

    const filePath = path.join(fixturesDir, `tier-${tier}-${seed}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));
  }

  await page.close();
}

async function run() {
  const fixturesDir = path.join(__dirname, "..", "fixtures");
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

run().catch(console.error);
