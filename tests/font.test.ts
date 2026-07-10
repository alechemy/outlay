import * as fs from "fs";
import * as path from "path";
import { solveLayout } from "../src/solver";
import { parseFont, wordAdvance, spaceAdvance, measureText } from "../src/font";
import { textNode } from "../src/text";

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

const ASSETS = path.join(import.meta.dirname, "assets");
const fontBytes = fs.readFileSync(path.join(ASSETS, "Inter-Regular.ttf"));
const font = parseFont(
  new Uint8Array(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength),
);
const gt = JSON.parse(
  fs.readFileSync(path.join(ASSETS, "font-ground-truth.json"), "utf8"),
) as {
  sizes: number[];
  kerningOff: Record<string, Record<string, number>>;
  shaped: Record<string, Record<string, number>>;
};

// parseFont reads sane header metrics
{
  assert(
    font.unitsPerEm === 1000 || font.unitsPerEm === 2048,
    `unitsPerEm is 1000 or 2048 (got ${font.unitsPerEm})`,
  );
  assert(font.ascent > 0, "ascent is positive");
  assert(font.descent > 0, "descent is a positive magnitude");
}

// Unshaped advances match Chromium (kerning + ligatures off) within 0.05px
{
  let maxDiff = 0;
  let worst = "";
  for (const size of gt.sizes) {
    for (const [word, width] of Object.entries(gt.kerningOff[String(size)])) {
      if (/\s/.test(word)) continue;
      const diff = Math.abs(wordAdvance(font, word, size) - width);
      if (diff > maxDiff) {
        maxDiff = diff;
        worst = `"${word}" @${size}px`;
      }
    }
  }
  assert(
    maxDiff <= 0.05,
    `every kerning-off word within 0.05px (max ${maxDiff.toFixed(5)}px at ${worst})`,
  );
}

// Space advance matches the captured space width within 0.05px
{
  for (const size of gt.sizes) {
    const ko = gt.kerningOff[String(size)];
    const captured = ko["x x"] - 2 * ko["x"];
    assert(
      Math.abs(spaceAdvance(font, size) - captured) <= 0.05,
      `spaceAdvance matches captured space width @${size}px`,
    );
  }
}

// advanceOf throws on an unmapped codepoint (U+4E00, absent from Inter)
{
  let threw = false;
  try {
    font.advanceOf(0x4e00);
  } catch {
    threw = true;
  }
  assert(threw, "advanceOf throws on an unmapped codepoint");
}

// measureText drives layout: a narrow column wraps the text to multiple lines
{
  const lineHeight = 20;
  const measure = measureText(font, "the quick brown fox jumps over", {
    size: 16,
    lineHeight,
  });
  const label = textNode(measure, { id: "label" });
  const { boxes } = solveLayout({
    id: "root",
    width: 80,
    height: 300,
    flexDirection: "column",
    children: [label],
  });
  const box = boxes.get("label")!;
  assert(box.width <= 80, "leaf width fits the narrow column");
  assert(box.height === measure(box.width).height, "leaf height is the wrapped text height");
  assert(box.height > lineHeight, "narrow text wraps to more than one line");
}

// Default shaping diverges from unshaped sums — documented, not asserted tight
{
  let maxShaped = 0;
  let worst = "";
  for (const size of gt.sizes) {
    for (const [word, width] of Object.entries(gt.shaped[String(size)])) {
      if (/\s/.test(word)) continue;
      const diff = Math.abs(wordAdvance(font, word, size) - width);
      if (diff > maxShaped) {
        maxShaped = diff;
        worst = `"${word}" @${size}px`;
      }
    }
  }
  assert(
    maxShaped > 0.05,
    `default-shaping captures diverge from unshaped sums (max ${maxShaped.toFixed(3)}px at ${worst})`,
  );
  console.log(
    `  note: default shaping diverges up to ${maxShaped.toFixed(3)}px vs unshaped sums (${worst})`,
  );
}

console.log(`\n--- Font Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
