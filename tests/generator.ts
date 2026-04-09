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

function genNode(rng: RNG, depth: number, tier: number): LayoutNode {
  const id = idCounter === 1 ? "root-node" : `node-${idCounter}`;
  idCounter++;

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
  }

  if (depth > 0) {
    const numChildren =
      tier >= 2 && tier <= 4 ? rng.nextRange(2, 5) : rng.nextRange(1, 3);
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
    `margin: ${node.margin.top}px ${node.margin.right}px ${node.margin.bottom}px ${node.margin.left}px`,
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
  if (node.minWidth !== undefined) styles.push(`min-width: ${node.minWidth}px`);
  if (node.maxWidth !== undefined) styles.push(`max-width: ${node.maxWidth}px`);

  const childrenHtml = node.children.map(toHTML).join("\n");
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
    const tree = genNode(rng, tier >= 2 && tier <= 4 ? 1 : 2, tier);

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

    const fixture = {
      tier,
      seed,
      description: `Tier ${tier} randomly generated fixture (seed ${seed})`,
      input: tree,
      expected,
      chromiumVersion: version,
      tolerance: 0.5,
    };

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
  }

  for (const task of tasks) {
    await generateFixtures(browser, task.tier, task.count, fixturesDir);
  }

  await browser.close();
  console.log("Done.");
}

run().catch(console.error);
