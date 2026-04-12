import * as fs from "fs";
import * as htmlparser2 from "htmlparser2";
import * as path from "path";
import puppeteer from "puppeteer";
import { BoxSides, LayoutNode } from "../src/types";

const YOGA_FIXTURES_URL =
  "https://raw.githubusercontent.com/facebook/yoga/main/gentest/fixtures/";

const TEST_FILES = [
  "YGAlignContentTest.html",
  "YGAlignItemsTest.html",
  "YGAlignSelfTest.html",
  "YGBorderTest.html",
  "YGBoxSizingTest.html",
  "YGDimensionTest.html",
  "YGDisplayTest.html",
  "YGFlexDirectionTest.html",
  "YGFlexTest.html",
  "YGFlexWrapTest.html",
  "YGGapTest.html",
  "YGJustifyContentTest.html",
  "YGMarginTest.html",
  "YGPaddingTest.html",
];

function parsePx(value: string | undefined): number {
  if (!value) return 0;
  if (value === "auto") return 0; // Simplified for now
  if (value.endsWith("px")) return parseFloat(value);
  if (value.endsWith("%")) return 0; // Skip percentages for basic tests
  return parseFloat(value) || 0;
}

function parseBoxSides(styleStr: string, prefix: string): BoxSides {
  const styles = parseStyleString(styleStr);
  const sides: BoxSides = { top: 0, right: 0, bottom: 0, left: 0 };

  if (styles[prefix]) {
    const val = parsePx(styles[prefix]);
    sides.top = val;
    sides.right = val;
    sides.bottom = val;
    sides.left = val;
  }

  if (styles[`${prefix}-top`]) sides.top = parsePx(styles[`${prefix}-top`]);
  if (styles[`${prefix}-right`])
    sides.right = parsePx(styles[`${prefix}-right`]);
  if (styles[`${prefix}-bottom`])
    sides.bottom = parsePx(styles[`${prefix}-bottom`]);
  if (styles[`${prefix}-left`]) sides.left = parsePx(styles[`${prefix}-left`]);

  return sides;
}

function parseStyleString(style: string | undefined): Record<string, string> {
  if (!style) return {};
  const rules = style.split(";");
  const result: Record<string, string> = {};
  for (const rule of rules) {
    const [key, value] = rule.split(":");
    if (key && value) {
      result[key.trim().toLowerCase()] = value.trim().toLowerCase();
    }
  }
  return result;
}

function elementToLayoutNode(el: any, idCounter: { val: number }): LayoutNode {
  const styles = parseStyleString(el.attribs.style);

  const widthStr = styles["width"];
  const heightStr = styles["height"];
  const width = widthStr
    ? widthStr.endsWith("%")
      ? undefined
      : parsePx(widthStr)
    : undefined;
  const height = heightStr
    ? heightStr.endsWith("%")
      ? undefined
      : parsePx(heightStr)
    : undefined;

  const node: LayoutNode = {
    id: el.attribs.id || `node-${idCounter.val++}`,
    width,
    height,
    padding: parseBoxSides(el.attribs.style, "padding"),
    margin: parseBoxSides(el.attribs.style, "margin"),
    border: parseBoxSides(el.attribs.style, "border"),
    boxSizing: (styles["box-sizing"] === "border-box"
      ? "border-box"
      : "content-box") as "content-box" | "border-box",
    display: (styles["display"] === "none"
      ? "none"
      : styles["display"] === "block"
        ? "block"
        : "flex") as any,
    flexDirection: (styles["flex-direction"] as any) || "row",
    justifyContent: (styles["justify-content"] as any) || "flex-start",
    alignItems: (styles["align-items"] as any) || "stretch",
    flexWrap:
      (styles["flex-wrap"] as "nowrap" | "wrap" | "wrap-reverse") || "nowrap",
    flexGrow: styles["flex-grow"] ? parseFloat(styles["flex-grow"]) : 0,
    flexShrink: styles["flex-shrink"] ? parseFloat(styles["flex-shrink"]) : 1,
    flexBasis:
      styles["flex-basis"] === undefined || styles["flex-basis"] === "auto"
        ? "auto"
        : parsePx(styles["flex-basis"]),
    gap: parsePx(styles["gap"]),
    children: [],
  };

  const children = el.children.filter((c: any) => c.type === "tag");
  for (const child of children) {
    node.children.push(elementToLayoutNode(child, idCounter));
  }

  return node;
}

async function extractTestsFromHtml(html: string): Promise<LayoutNode[]> {
  const tests: LayoutNode[] = [];

  const parser = new htmlparser2.Parser({
    onopentag(name, attribs) {
      // Yoga gentest html files have tests as top-level div elements with IDs
      if (name === "div" && attribs.id && !attribs.id.includes("-")) {
        // We'll let DOM handler construct the tree
      }
    },
  });

  const dom = htmlparser2.parseDocument(html);

  const rootDivs = dom.children.filter(
    (n) => n.type === "tag" && n.name === "div" && n.attribs.id,
  );

  for (const el of rootDivs) {
    const idCounter = { val: 1 };
    tests.push(elementToLayoutNode(el, idCounter));
  }

  return tests;
}

function toHTML(node: LayoutNode): string {
  const styles = [];

  if (node.width !== undefined) styles.push(`width: ${node.width}px`);
  if (node.height !== undefined) styles.push(`height: ${node.height}px`);

  if (
    node.padding.top ||
    node.padding.right ||
    node.padding.bottom ||
    node.padding.left
  ) {
    styles.push(
      `padding: ${node.padding.top}px ${node.padding.right}px ${node.padding.bottom}px ${node.padding.left}px`,
    );
  }

  if (
    node.margin.top ||
    node.margin.right ||
    node.margin.bottom ||
    node.margin.left
  ) {
    styles.push(
      `margin: ${node.margin.top}px ${node.margin.right}px ${node.margin.bottom}px ${node.margin.left}px`,
    );
  }

  if (
    node.border.top ||
    node.border.right ||
    node.border.bottom ||
    node.border.left
  ) {
    styles.push(
      `border-width: ${node.border.top}px ${node.border.right}px ${node.border.bottom}px ${node.border.left}px`,
    );
    styles.push(`border-style: solid`);
    styles.push(`border-color: black`);
  }

  if (node.boxSizing !== "content-box")
    styles.push(`box-sizing: ${node.boxSizing}`);

  styles.push(`display: ${node.display}`);

  if (node.display === "flex") {
    if (node.flexDirection !== "row")
      styles.push(`flex-direction: ${node.flexDirection}`);
    if (node.justifyContent !== "flex-start")
      styles.push(`justify-content: ${node.justifyContent}`);
    if (node.alignItems !== "stretch")
      styles.push(`align-items: ${node.alignItems}`);
    if (node.flexWrap !== "nowrap") styles.push(`flex-wrap: ${node.flexWrap}`);
    if (node.gap) styles.push(`gap: ${node.gap}px`);
  }

  if (node.flexGrow) styles.push(`flex-grow: ${node.flexGrow}`);
  if (node.flexShrink !== 1) styles.push(`flex-shrink: ${node.flexShrink}`);
  if (node.flexBasis !== undefined && node.flexBasis !== "auto")
    styles.push(`flex-basis: ${node.flexBasis}px`);

  const styleAttr = styles.join("; ");
  const childrenHtml = node.children.map(toHTML).join("\n");

  return `<div id="${node.id}" style="${styleAttr}">${childrenHtml}</div>`;
}

async function run() {
  const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "yoga");
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const version = await browser.version();

  let testCount = 0;
  let successCount = 0;

  for (const filename of TEST_FILES) {
    console.log(`Fetching ${filename}...`);
    try {
      const response = await fetch(`${YOGA_FIXTURES_URL}${filename}`);
      if (!response.ok) {
        console.error(`Failed to fetch ${filename}: ${response.statusText}`);
        continue;
      }
      const html = await response.text();
      const nodes = await extractTestsFromHtml(html);

      console.log(`Found ${nodes.length} tests in ${filename}`);

      for (const node of nodes) {
        if (successCount >= 50) break;

        testCount++;

        const testHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { margin: 0; padding: 0; }
              #${node.id} { position: absolute; left: 0; top: 0; }
            </style>
          </head>
          <body>
            ${toHTML(node)}
          </body>
          </html>
        `;

        await page.setContent(testHtml);

        const expected = await page.evaluate((rootId) => {
          const rootEl = document.getElementById(rootId)!;
          if (!rootEl) return null;

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
        }, node.id);

        if (!expected) continue;

        const fixture = {
          tier: 2, // Yoga tests contain flexbox, so they are Tier 2+
          seed: successCount,
          description: `Yoga test: ${node.id} (from ${filename})`,
          input: node,
          expected,
          chromiumVersion: version,
          tolerance: 0.5,
        };

        const filePath = path.join(fixturesDir, `yoga-${node.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));
        successCount++;

        if (successCount >= 50) break;
      }
    } catch (e) {
      console.error(`Error processing ${filename}:`, e);
    }

    if (successCount >= 50) break;
  }

  await browser.close();
  console.log(
    `Done. Successfully converted ${successCount} Yoga tests to fixtures.`,
  );
}

run().catch(console.error);
