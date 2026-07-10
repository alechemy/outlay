import * as fs from "fs";
import * as path from "path";
import { htmlToSvg, htmlToLayout } from "../src/render";
import { parseHTML, HTMLParseError } from "../src/html";
import { solveLayout } from "../src/solver";
import { parseFont, wordAdvance, spaceAdvance } from "../src/font";
import { breakLines } from "../src/text";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function catchErr(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

const ASSETS = path.join(import.meta.dirname, "assets");
const fontBytes = fs.readFileSync(path.join(ASSETS, "Inter-Regular.ttf"));
const interBytes = new Uint8Array(
  fontBytes.buffer,
  fontBytes.byteOffset,
  fontBytes.byteLength,
);
const font = parseFont(interBytes);
const opts = { fonts: { Inter: interBytes }, defaultFont: "Inter" };

// --- Grid: 200px 1fr columns, two cells with backgrounds ---
{
  const svg = htmlToSvg(
    `<div style="display: grid; width: 600px; height: 100px; grid-template-columns: 200px 1fr">
       <div style="background: #f00"></div>
       <div style="background: #00f"></div>
     </div>`,
    opts,
  );
  assert(
    svg.includes(`x="0" y="0" width="200" height="100" fill="#f00"`),
    "first cell fills the 200px column",
  );
  assert(
    svg.includes(`x="200" y="0" width="400" height="100" fill="#00f"`),
    "second cell fills the 1fr column at x=200",
  );
}

// --- Text wrapping: painted lines match breakLines at the block width ---
{
  const size = 16;
  const lineHeight = 20;
  const width = 120;
  const sentence = "the quick brown fox jumps over";
  const words = sentence.split(" ");
  const advances = words.map((w) => wordAdvance(font, w, size));
  const spaceWidth = spaceAdvance(font, size);
  const broken = breakLines(advances, { spaceWidth })(width);
  const expected = broken.map((l) => words.slice(l.start, l.end).join(" "));

  const svg = htmlToSvg(
    `<div style="font-family: Inter; font-size: ${size}px; line-height: ${lineHeight}px; width: ${width}px">${sentence}</div>`,
    opts,
  );
  assert(expected.length >= 2, "sentence wraps to multiple lines at 120px");
  assert(
    count(svg, "<text") === expected.length,
    `painted <text> count matches breakLines (${expected.length})`,
  );
  for (const line of expected) {
    assert(svg.includes(`>${line}</text>`), `painted line "${line}" present`);
  }
  assert(svg.includes(`textLength="`), "wrapped lines carry textLength");
}

// --- Inheritance: font-size and color cascade to a child text leaf ---
{
  const svg = htmlToSvg(
    `<div style="font-family: Inter; font-size: 24px; color: #ff0000; width: 300px"><div>Hi there</div></div>`,
    opts,
  );
  assert(svg.includes(`font-size="24"`), "child inherits parent font-size");
  assert(svg.includes(`fill="#ff0000"`), "child inherits parent color");
}

// --- line-height: normal resolves from the font metrics ---
{
  const size = 20;
  const expected = ((font.ascent + font.descent + font.lineGap) / font.unitsPerEm) * size;
  const { tree, styles } = htmlToLayout(
    `<div style="display: flex; align-items: flex-start; width: 300px; height: 100px"><div style="font-family: Inter; font-size: ${size}px">Hi</div></div>`,
    opts,
  );
  const leaf = tree.children![0];
  const text = styles.get(leaf)!.text!;
  assert(
    Math.abs(text.lineHeight - expected) < 1e-9,
    `line-height: normal = (${font.ascent}+${font.descent}+${font.lineGap})/${font.unitsPerEm} x ${size} = ${expected}`,
  );
  const result = solveLayout(tree);
  assert(
    Math.abs(result.nodes.get(leaf)!.height - expected) < 1e-9,
    "single-line text leaf's cross size equals the resolved normal line-height",
  );
}

// --- text-align: center anchors the text in the middle ---
{
  const svg = htmlToSvg(
    `<div style="font-family: Inter; text-align: center; width: 200px">Hi there</div>`,
    opts,
  );
  assert(svg.includes(`text-anchor="middle"`), "text-align center anchors middle");
}

// --- Border: uniform border + border-color paints an inset stroke ---
{
  const svg = htmlToSvg(
    `<div style="width: 100px; height: 50px; border: 2px; border-color: #333"></div>`,
    opts,
  );
  assert(
    svg.includes(`x="1" y="1" width="102" height="52"`),
    "stroke rect inset by strokeWidth/2 with 2px shaved off each extent",
  );
  assert(
    svg.includes(`stroke="#333" stroke-width="2"`),
    "stroke paints the border-color at the border width",
  );
}

// Border color also read from the border shorthand's color component
{
  const svg = htmlToSvg(
    `<div style="width: 40px; height: 40px; border: 3px solid #0a0"></div>`,
    opts,
  );
  assert(
    svg.includes(`stroke="#0a0" stroke-width="3"`),
    "border shorthand color drives the stroke",
  );
}

// --- Errors ---
{
  const e = catchErr(() =>
    htmlToSvg(
      `<div style="font-family: Comic Sans; font-size: 16px">hi</div>`,
      opts,
    ),
  );
  assert(
    e instanceof Error &&
      e.message.includes("Comic Sans") &&
      e.message.includes("Inter"),
    "unknown font family names the family and the known ones",
  );
}
{
  const e = catchErr(() =>
    htmlToSvg(`<div style="font-family: Inter">hello <span></span></div>`, opts),
  );
  assert(
    e instanceof HTMLParseError && /anonymous boxes/.test(e.message),
    "mixed text + element children throws (no anonymous boxes)",
  );
}
{
  const e = catchErr(() =>
    htmlToSvg(`<div style="display: flex; font-family: Inter">hi</div>`, opts),
  );
  assert(
    e instanceof HTMLParseError && /anonymous boxes/.test(e.message),
    "text inside explicit display: flex throws",
  );
}
{
  const e = catchErr(() =>
    htmlToSvg(`<div style="background: linear-gradient(#fff, #000)"></div>`, opts),
  );
  assert(
    e instanceof HTMLParseError && /solid colors/.test(e.message),
    "gradient background is rejected",
  );
}
{
  const e = catchErr(() => parseHTML(`<div>hi</div>`));
  assert(
    e instanceof HTMLParseError && /no text layout/.test(e.message),
    "plain parseHTML without render options still throws on text",
  );
}

// --- Determinism: identical input yields byte-identical output ---
{
  const html = `<div style="display: grid; width: 300px; height: 80px; grid-template-columns: 1fr 1fr; gap: 8px">
      <div style="background: #eee; border-radius: 4px"></div>
      <div style="font-family: Inter; font-size: 14px; color: #123">hello world</div>
    </div>`;
  assert(htmlToSvg(html, opts) === htmlToSvg(html, opts), "same input, identical SVG");
}

console.log(`\n--- Render (htmlToSvg) Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
