/**
 * Ground-truth capture for the outlay/font parser.
 *
 * Registers the committed Inter-Regular.ttf in headless Chromium via an
 * @font-face data: URL and measures a diverse word set at two font sizes with
 * an absolutely-positioned `white-space: pre` span. Words are measured twice:
 * once with kerning and ligatures off (`kerningOff`, the contract the parser's
 * unshaped advance sums must reproduce) and once with default shaping
 * (`shaped`, so the shaping divergence is committed data). Writes
 * tests/assets/font-ground-truth.json.
 *
 *   npx tsx scripts/capture-font-ground-truth.ts
 */

import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";

const ASSETS = path.join(import.meta.dirname, "..", "tests", "assets");
const FONT_FILE = "Inter-Regular.ttf";
const SIZES = [16, 31.5];

const WORDS = [
  "Hello",
  "World",
  "Layout",
  "Flexbox",
  "the",
  "quick",
  "brown",
  "jumps",
  "CSS",
  "HTML",
  "camelCase",
  "snake_case",
  "AVATAR",
  "Type",
  "Wave",
  "Yo",
  "To.",
  "don't",
  "e.g.,",
  "(paren)",
  "hyphen-ated",
  "semi;colon",
  "12345",
  "3.14159",
  "1,000",
  "x",
  "x x",
];

async function main() {
  const b64 = fs.readFileSync(path.join(ASSETS, FONT_FILE)).toString("base64");

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><head></head><body></body></html>");
  await page.addStyleTag({
    content: `@font-face { font-family: 'GT'; src: url(data:font/ttf;base64,${b64}) format('truetype'); }`,
  });
  await page.evaluate(
    `(async () => {
      await Promise.all([${SIZES.map((s) => `document.fonts.load('${s}px "GT"')`).join(", ")}]);
      await document.fonts.ready;
    })()`,
  );

  const measureInPage = `(params) => {
    const { words, sizes } = params;
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.left = "0";
    probe.style.top = "0";
    probe.style.whiteSpace = "pre";
    probe.style.fontFamily = "GT";
    document.body.appendChild(probe);
    const run = (kerningOff) => {
      probe.style.fontKerning = kerningOff ? "none" : "auto";
      probe.style.fontFeatureSettings = kerningOff ? "'liga' 0, 'clig' 0" : "normal";
      const out = {};
      for (const size of sizes) {
        probe.style.fontSize = size + "px";
        const bySize = {};
        for (const w of words) {
          probe.textContent = w;
          bySize[w] = probe.getBoundingClientRect().width;
        }
        out[String(size)] = bySize;
      }
      return out;
    };
    const kerningOff = run(true);
    const shaped = run(false);
    probe.remove();
    return { kerningOff, shaped };
  }`;

  const measured = (await page.evaluate(
    `(${measureInPage})(${JSON.stringify({ words: WORDS, sizes: SIZES })})`,
  )) as {
    kerningOff: Record<string, Record<string, number>>;
    shaped: Record<string, Record<string, number>>;
  };

  const chromiumVersion = await browser.version();
  await browser.close();

  const groundTruth = {
    font: FONT_FILE,
    chromiumVersion,
    sizes: SIZES,
    spaceProbe: { pair: "x x", single: "x" },
    ...measured,
  };

  const outPath = path.join(ASSETS, "font-ground-truth.json");
  fs.writeFileSync(outPath, JSON.stringify(groundTruth, null, 2) + "\n");
  console.error(
    `Captured ${WORDS.length} words × ${SIZES.length} sizes (${chromiumVersion}) → ${path.relative(process.cwd(), outPath)}`,
  );
}

main();
