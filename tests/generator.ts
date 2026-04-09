import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";
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

function genNode(rng: RNG, depth: number): LayoutNode {
  const id = idCounter === 1 ? "root-node" : `node-${idCounter}`;
  idCounter++;

  const width = rng.nextRange(50, 300);
  const height = rng.nextRange(50, 300);

  const padding = genBoxSides(rng, 20);
  const margin = genBoxSides(rng, 20);
  // Prevent sibling margin collapse for Tier 1 standard block layout
  margin.bottom = 0;

  const border = genBoxSides(rng, 10);
  // Ensure border > 0 or padding > 0 to prevent parent/child margin collapse
  if (border.top === 0 && padding.top === 0) border.top = 1;
  if (border.bottom === 0 && padding.bottom === 0) border.bottom = 1;

  const boxSizing = rng.nextChoice(["content-box", "border-box"] as const);

  const node: LayoutNode = {
    id,
    width,
    height,
    padding,
    margin,
    border,
    boxSizing,
    display: "block",
    children: [],
  };

  if (depth > 0) {
    const numChildren = rng.nextRange(1, 3);
    for (let i = 0; i < numChildren; i++) {
      node.children.push(genNode(rng, depth - 1));
    }
  }

  return node;
}

function toHTML(node: LayoutNode): string {
  const styles = [
    `width: ${node.width}px`,
    `height: ${node.height}px`,
    `padding: ${node.padding.top}px ${node.padding.right}px ${node.padding.bottom}px ${node.padding.left}px`,
    `margin: ${node.margin.top}px ${node.margin.right}px ${node.margin.bottom}px ${node.margin.left}px`,
    `border-width: ${node.border.top}px ${node.border.right}px ${node.border.bottom}px ${node.border.left}px`,
    `border-style: solid`,
    `border-color: black`,
    `box-sizing: ${node.boxSizing}`,
    `display: ${node.display}`,
  ].join("; ");

  const childrenHtml = node.children.map(toHTML).join("\n");
  return `<div id="${node.id}" style="${styles}">${childrenHtml}</div>`;
}

async function run() {
  const fixturesDir = path.join(__dirname, "..", "fixtures");
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const version = await browser.version();

  const NUM_FIXTURES = 50;
  console.log(`Generating ${NUM_FIXTURES} fixtures for Tier 1...`);

  for (let i = 0; i < NUM_FIXTURES; i++) {
    const seed = 10000 + i;
    const rng = new RNG(seed);
    idCounter = 1;
    const tree = genNode(rng, 2); // Generate up to depth 2

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
      tier: 1,
      seed,
      description: `Tier 1 randomly generated fixture (seed ${seed})`,
      input: tree,
      expected,
      chromiumVersion: version,
      tolerance: 0.5,
    };

    const filePath = path.join(fixturesDir, `tier-1-${seed}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));
  }

  await browser.close();
  console.log("Done.");
}

run().catch(console.error);
