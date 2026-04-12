import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";

const WPT_BASE_URL =
  "https://raw.githubusercontent.com/web-platform-tests/wpt/master/css/css-flexbox/";

const TEST_FILES = [
  "flexbox_align-content-center.html",
  "flexbox_align-items-center.html",
  "flexbox_flex-direction-row.html",
  "flexbox_justify-content-space-between.html",
  "flexbox_flex-wrap-wrap.html",
];

async function run() {
  const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "wpt");
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const version = await browser.version();

  let successCount = 0;

  for (const filename of TEST_FILES) {
    console.log(`Fetching ${filename}...`);
    try {
      const response = await fetch(`${WPT_BASE_URL}${filename}`);
      if (!response.ok) {
        console.error(`Failed to fetch ${filename}: ${response.statusText}`);
        continue;
      }
      const html = await response.text();

      // We load the raw HTML into Puppeteer
      await page.setContent(html, { waitUntil: "networkidle0" });

      // Run evaluation script in page context to extract layout tree and expected boxes
      const result = await page.evaluate(() => {
        let idCounter = 1;

        function parsePx(val: string) {
          if (!val || val === "auto" || val === "none") return 0;
          return parseFloat(val) || 0;
        }

        // We assume the first <div> in the body is the root container for the test.
        // WPT tests often just have one root div containing spans or divs.
        const rootEl = document.querySelector("body > div");
        if (!rootEl) return null;

        // Force a stable origin
        rootEl.setAttribute(
          "style",
          (rootEl.getAttribute("style") || "") +
            "; position: absolute; left: 0; top: 0; margin: 0;",
        );

        const rootRect = rootEl.getBoundingClientRect();
        const rootStyle = window.getComputedStyle(rootEl);
        const rootOriginX =
          rootRect.left +
          parsePx(rootStyle.borderLeftWidth) +
          parsePx(rootStyle.paddingLeft);
        const rootOriginY =
          rootRect.top +
          parsePx(rootStyle.borderTopWidth) +
          parsePx(rootStyle.paddingTop);

        const expectedBoxes: Record<string, any> = {};

        function buildNode(el: HTMLElement): any {
          const style = window.getComputedStyle(el);
          const id = el.id || `wpt-node-${idCounter++}`;
          el.id = id;

          const rect = el.getBoundingClientRect();

          const borderTop = parsePx(style.borderTopWidth);
          const borderRight = parsePx(style.borderRightWidth);
          const borderBottom = parsePx(style.borderBottomWidth);
          const borderLeft = parsePx(style.borderLeftWidth);

          const paddingTop = parsePx(style.paddingTop);
          const paddingRight = parsePx(style.paddingRight);
          const paddingBottom = parsePx(style.paddingBottom);
          const paddingLeft = parsePx(style.paddingLeft);

          const marginTop = parsePx(style.marginTop);
          const marginRight = parsePx(style.marginRight);
          const marginBottom = parsePx(style.marginBottom);
          const marginLeft = parsePx(style.marginLeft);

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

          const x = rect.left - rootOriginX;
          const y = rect.top - rootOriginY;

          expectedBoxes[id] = {
            id,
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
            outerWidth: borderBoxWidth + marginLeft + marginRight,
            outerHeight: borderBoxHeight + marginTop + marginBottom,
          };

          const children: any[] = [];
          for (let i = 0; i < el.children.length; i++) {
            const childEl = el.children[i] as HTMLElement;
            // Ignore script/style tags
            if (
              childEl.tagName !== "SCRIPT" &&
              childEl.tagName !== "STYLE" &&
              childEl.tagName !== "LINK"
            ) {
              children.push(buildNode(childEl));
            }
          }

          // Build Input LayoutNode
          const flexBasisMatch = style.flexBasis.match(/^([\d.]+)px$/);
          let flexBasis: any = style.flexBasis;
          if (flexBasisMatch) flexBasis = parseFloat(flexBasisMatch[1]);
          if (flexBasis === "auto") flexBasis = "auto";

          let widthVal: any = style.width;
          if (widthVal.endsWith("px")) widthVal = parseFloat(widthVal);

          let heightVal: any = style.height;
          if (heightVal.endsWith("px")) heightVal = parseFloat(heightVal);

          return {
            id,
            width: widthVal,
            height: heightVal,
            padding: {
              top: paddingTop,
              right: paddingRight,
              bottom: paddingBottom,
              left: paddingLeft,
            },
            margin: {
              top: marginTop,
              right: marginRight,
              bottom: marginBottom,
              left: marginLeft,
            },
            border: {
              top: borderTop,
              right: borderRight,
              bottom: borderBottom,
              left: borderLeft,
            },
            boxSizing:
              style.boxSizing === "border-box" ? "border-box" : "content-box",
            display: style.display.includes("flex")
              ? "flex"
              : style.display.includes("grid")
                ? "grid"
                : style.display === "none"
                  ? "none"
                  : "block",
            flexDirection: style.flexDirection,
            flexWrap: style.flexWrap,
            justifyContent:
              style.justifyContent === "normal"
                ? "flex-start"
                : style.justifyContent,
            alignItems:
              style.alignItems === "normal" ? "stretch" : style.alignItems,
            alignContent:
              style.alignContent === "normal" ? "stretch" : style.alignContent,
            flexGrow: parseFloat(style.flexGrow) || 0,
            flexShrink: parseFloat(style.flexShrink) || 1,
            flexBasis,
            gap: parsePx(style.rowGap), // simplified for standard gap
            children,
          };
        }

        const inputNode = buildNode(rootEl as HTMLElement);
        return { input: inputNode, expected: expectedBoxes };
      });

      if (!result) {
        console.warn(`Could not extract test data from ${filename}`);
        continue;
      }

      const fixture = {
        tier: 3, // WPT tests are comprehensive edge cases, often tier 3+
        seed: successCount,
        description: `WPT Test: ${filename}`,
        input: result.input,
        expected: result.expected,
        chromiumVersion: version,
        tolerance: 0.5,
      };

      const baseName = filename.replace(".html", "");
      const filePath = path.join(fixturesDir, `wpt-${baseName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));
      successCount++;
    } catch (e) {
      console.error(`Error processing ${filename}:`, e);
    }
  }

  await browser.close();

  console.log("\n=================================");
  console.log("=== WPT Conversion Assessment ===");
  console.log("=================================\n");
  console.log(`Successfully converted ${successCount} WPT tests to fixtures.`);
  console.log("\nConversion Difficulty: HIGH");
  console.log("Reasoning:");
  console.log(
    "1. WPT tests rely heavily on global <style> tags, pseudo-classes (e.g. :nth-child), and inherited CSS properties which require a full CSSOM parser to convert statically.",
  );
  console.log(
    "2. The only feasible way to convert them reliably is dynamically via Headless Chrome (as done in this script) where we extract computed styles into our explicit input format.",
  );
  console.log(
    "3. WPT often tests browser-specific quirks, text measurement dependencies, and multi-line breaks that don't always translate cleanly to our fixed geometry inputs.",
  );
  console.log("\nCoverage Overlap:");
  console.log(
    "There is substantial overlap with our Tiers 2-4 randomly generated flexbox tests, as well as the Yoga suite. However, WPT includes deep edge cases (e.g. orthogonal writing modes, deeply nested percentage resolutions) that are out of scope for our immediate algorithm targets.",
  );
}

run().catch(console.error);
