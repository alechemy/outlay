/**
 * probe-chromium.ts
 *
 * Ad-hoc Chromium layout probe for debugging. Renders a snippet of HTML (or a
 * LayoutNode JSON tree) in headless Chromium and prints the computed box values
 * for every element, exactly as the fixture generator captures them.
 *
 * Usage:
 *
 *   # Inline HTML string
 *   npm run probe -- --html '<div id="a" style="display:flex; width:300px"><div id="b" style="flex:1"></div></div>'
 *
 *   # HTML file
 *   npm run probe -- --file path/to/snippet.html
 *
 *   # LayoutNode JSON (same format as fixture "input")
 *   npm run probe -- --json path/to/node.json
 *
 *   # Existing fixture (re-renders the input and compares to saved expected)
 *   npm run probe -- --fixture fixtures/tier-3-30042.json
 *
 * Output is printed to stdout. Pass --json-out to get raw JSON instead of the
 * formatted table (useful for piping into jq or saving as a new fixture).
 */

import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";

// Minimal LayoutNode → HTML converter (mirrors generator.ts toHTML)
function toHTML(node: any): string {
  const s = (v: string | number | undefined, unit = "px") =>
    v !== undefined ? `${v}${typeof v === "number" ? unit : ""}` : null;

  const styles: (string | null)[] = [
    s(node.width) && `width: ${s(node.width)}`,
    s(node.height) && `height: ${s(node.height)}`,
    `padding: ${node.padding.top}px ${node.padding.right}px ${node.padding.bottom}px ${node.padding.left}px`,
    `margin: ${node.margin.top === "auto" ? "auto" : node.margin.top + "px"} ${node.margin.right === "auto" ? "auto" : node.margin.right + "px"} ${node.margin.bottom === "auto" ? "auto" : node.margin.bottom + "px"} ${node.margin.left === "auto" ? "auto" : node.margin.left + "px"}`,
    `border-width: ${node.border.top}px ${node.border.right}px ${node.border.bottom}px ${node.border.left}px`,
    `border-style: solid`,
    `border-color: transparent`,
    `box-sizing: ${node.boxSizing ?? "content-box"}`,
    `display: ${node.display ?? "block"}`,
    node.flexDirection && `flex-direction: ${node.flexDirection}`,
    node.flexWrap && `flex-wrap: ${node.flexWrap}`,
    node.alignItems && `align-items: ${node.alignItems}`,
    node.justifyContent && `justify-content: ${node.justifyContent}`,
    node.alignContent && `align-content: ${node.alignContent}`,
    node.alignSelf && node.alignSelf !== "auto" && `align-self: ${node.alignSelf}`,
    node.flexGrow !== undefined && `flex-grow: ${node.flexGrow}`,
    node.flexShrink !== undefined && `flex-shrink: ${node.flexShrink}`,
    node.flexBasis !== undefined &&
      `flex-basis: ${typeof node.flexBasis === "number" ? node.flexBasis + "px" : node.flexBasis}`,
    node.order !== undefined && `order: ${node.order}`,
    node.minWidth !== undefined && `min-width: ${node.minWidth}px`,
    node.maxWidth !== undefined && `max-width: ${node.maxWidth}px`,
    node.minHeight !== undefined && `min-height: ${node.minHeight}px`,
    node.maxHeight !== undefined && `max-height: ${node.maxHeight}px`,
  ].filter(Boolean);

  const children = (node.children ?? []).map(toHTML).join("\n");
  return `<div id="${node.id}" style="${styles.join("; ")}">${children}</div>`;
}

function wrapHTML(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 0; }
    #root-node, [data-probe-root] { position: absolute; left: 0; top: 0; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

const EXTRACT_BOXES = `(() => {
  const allDivs = document.querySelectorAll('div');
  const rootEl = allDivs[0];
  if (!rootEl) return {};
  const rootRect = rootEl.getBoundingClientRect();
  const rootStyle = window.getComputedStyle(rootEl);
  const originX = rootRect.left + parseFloat(rootStyle.borderLeftWidth) + parseFloat(rootStyle.paddingLeft);
  const originY = rootRect.top  + parseFloat(rootStyle.borderTopWidth)  + parseFloat(rootStyle.paddingTop);

  const boxes = {};
  allDivs.forEach(el => {
    const rect  = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const p = v => parseFloat(v) || 0;
    const bT = p(style.borderTopWidth),    bR = p(style.borderRightWidth);
    const bB = p(style.borderBottomWidth), bL = p(style.borderLeftWidth);
    const pT = p(style.paddingTop),        pR = p(style.paddingRight);
    const pB = p(style.paddingBottom),     pL = p(style.paddingLeft);
    const mT = p(style.marginTop),         mR = p(style.marginRight);
    const mB = p(style.marginBottom),      mL = p(style.marginLeft);
    const borderBoxWidth  = rect.width;
    const borderBoxHeight = rect.height;
    boxes[el.id || el.tagName + '_' + Array.from(allDivs).indexOf(el)] = {
      x: Math.round((rect.left - originX) * 100) / 100,
      y: Math.round((rect.top  - originY) * 100) / 100,
      width:  Math.round((borderBoxWidth  - bL - bR - pL - pR) * 100) / 100,
      height: Math.round((borderBoxHeight - bT - bB - pT - pB) * 100) / 100,
      borderBoxWidth:  Math.round(borderBoxWidth  * 100) / 100,
      borderBoxHeight: Math.round(borderBoxHeight * 100) / 100,
      outerWidth:  Math.round((borderBoxWidth  + mL + mR) * 100) / 100,
      outerHeight: Math.round((borderBoxHeight + mT + mB) * 100) / 100,
      padding: { top: pT, right: pR, bottom: pB, left: pL },
      border:  { top: bT, right: bR, bottom: bB, left: bL },
      margin:  { top: mT, right: mR, bottom: mB, left: mL },
    };
  });
  return boxes;
})()`;

function printTable(boxes: Record<string, any>) {
  const col = (s: string, w: number) => s.slice(0, w).padEnd(w);
  const num = (n: number) => String(n).padStart(8);

  console.log(
    col("id", 24) +
    col("x", 9) + col("y", 9) +
    col("w", 9) + col("h", 9) +
    col("bbW", 9) + col("bbH", 9),
  );
  console.log("-".repeat(78));

  for (const [id, b] of Object.entries(boxes)) {
    console.log(
      col(id, 24) +
      num(b.x) + " " + num(b.y) + " " +
      num(b.width) + " " + num(b.height) + " " +
      num(b.borderBoxWidth) + " " + num(b.borderBoxHeight),
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  const has = (flag: string) => args.includes(flag);

  const htmlArg     = get("--html");
  const fileArg     = get("--file");
  const jsonArg     = get("--json");
  const fixtureArg  = get("--fixture");
  const jsonOut     = has("--json-out");

  let html: string;
  let savedExpected: Record<string, any> | null = null;

  if (fixtureArg) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(fixtureArg), "utf-8"));
    html = wrapHTML(toHTML(fixture.input));
    savedExpected = fixture.expected;
  } else if (jsonArg) {
    const node = JSON.parse(fs.readFileSync(path.resolve(jsonArg), "utf-8"));
    html = wrapHTML(toHTML(node));
  } else if (fileArg) {
    html = fs.readFileSync(path.resolve(fileArg), "utf-8");
  } else if (htmlArg) {
    html = wrapHTML(htmlArg);
  } else {
    // Read HTML from stdin if no flags given
    if (process.stdin.isTTY) {
      console.error(
        "Usage: npm run probe -- [--html <html>] [--file <path>] [--json <path>] [--fixture <path>] [--json-out]",
      );
      process.exit(1);
    }
    html = wrapHTML(fs.readFileSync("/dev/stdin", "utf-8"));
  }

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html);

  const chromiumVersion = await browser.version();
  const boxes = await page.evaluate(EXTRACT_BOXES as any) as Record<string, any>;
  await browser.close();

  if (jsonOut) {
    console.log(JSON.stringify({ chromiumVersion, boxes }, null, 2));
    return;
  }

  console.log(`Chromium: ${chromiumVersion}\n`);
  printTable(boxes);

  if (savedExpected) {
    console.log("\n--- Diff vs fixture expected ---");
    let anyDiff = false;
    for (const [id, expected] of Object.entries(savedExpected)) {
      const actual = boxes[id];
      if (!actual) { console.log(`  ${id}: MISSING in Chromium output`); anyDiff = true; continue; }
      for (const prop of ["x", "y", "width", "height", "borderBoxWidth", "borderBoxHeight", "outerWidth", "outerHeight"] as const) {
        const e = (expected as any)[prop];
        const a = (actual as any)[prop];
        if (Math.abs(e - a) > 0.01) {
          console.log(`  [${id}] ${prop}: fixture=${e}, chromium=${a}, diff=${(a - e).toFixed(3)}`);
          anyDiff = true;
        }
      }
    }
    if (!anyDiff) console.log("  No differences — fixture matches current Chromium.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
