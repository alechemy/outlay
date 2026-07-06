import { solveLayout } from "../src/solver";
import {
  LAYOUT_UNIT,
  measureFromAdvances,
  measureFromWordWidths,
  snapToLayoutUnit,
  textNode,
} from "../src/text";

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

// Quantized fit: a prefix whose raw float sum exceeds the available width by
// less than 1/64 still fits, matching Chromium's floored accumulation.
{
  const spaceWidth = 4;
  const advances = [50.009, 46];
  const measure = measureFromAdvances(advances, { spaceWidth, lineHeight: 20 });
  const raw = advances[0] + spaceWidth + advances[1];
  const floored = snapToLayoutUnit(raw);
  assert(floored < raw, "test advances sit on a knife edge");
  const oneLine = measure(floored);
  assert(oneLine.height === 20, "floored width fits on one line");
  const twoLines = measure(floored - LAYOUT_UNIT);
  assert(twoLines.height === 40, "one LayoutUnit less wraps to two lines");
}

// min-content (width 0) is the widest word, floored to LayoutUnit
{
  const measure = measureFromAdvances([30.02, 71.99, 12], {
    spaceWidth: 4,
    lineHeight: 20,
  });
  const min = measure(0);
  assert(min.width === snapToLayoutUnit(71.99), "min-content is widest word floored");
  assert(min.height === 60, "min-content wraps every word");
}

// max-content (width Infinity) is the single-line sum, floored
{
  const measure = measureFromAdvances([30, 40], { spaceWidth: 4, lineHeight: 20 });
  const max = measure(Infinity);
  assert(max.width === 74, "max-content is the single-line sum");
  assert(max.height === 20, "max-content is one line");
}

// Word-widths table variant resolves words and rejects unknown ones
{
  const table = {
    spaceWidth: 4,
    lineHeight: 20,
    words: { hello: 40, world: 44 },
  };
  const measure = measureFromWordWidths("hello  world", table);
  assert(measure(Infinity).width === 88, "table-driven measure sums advances");
  let threw = false;
  try {
    measureFromWordWidths("hello there", table);
  } catch {
    threw = true;
  }
  assert(threw, "unknown word throws");
}

// textNode leaves drive layout: wrapped height feeds the flex row
{
  const label = textNode(
    measureFromAdvances([60, 60, 60], { spaceWidth: 10, lineHeight: 20 }),
    { id: "label" },
  );
  const { boxes } = solveLayout({
    id: "root",
    width: 150,
    height: 300,
    alignItems: "flex-start",
    children: [label],
  });
  const box = boxes.get("label")!;
  assert(box.height === 40, "wrapped text height drives the leaf box");
  assert(box.width === 150, "leaf width is the flex-resolved main size");
}

console.log(`\n--- Text Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
