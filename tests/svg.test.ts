import { solveLayout } from "../src/solver";
import { renderDebugSvg, renderToSvg } from "../src/svg";
import { breakLines, measureFromAdvances, textNode } from "../src/text";
import type { LayoutNode } from "../src/types";

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

// Styled boxes: rect geometry, fill/stroke/radius, unstyled nodes skipped
{
  const child: LayoutNode = { id: "child", width: 100, height: 40 };
  const tree: LayoutNode = {
    id: "root",
    width: 300,
    height: 200,
    padding: 20,
    children: [child, { id: "plain", width: 50, height: 10 }],
  };
  const result = solveLayout(tree);
  const svg = renderToSvg(tree, result, {
    style: (node) => {
      if (node.id === "root") return { fill: "#111", radius: 12 };
      if (node.id === "child") return { fill: "#222", stroke: "#333", strokeWidth: 2 };
      return undefined;
    },
  });
  assert(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"`), "canvas matches the root border box");
  assert(svg.includes(`<rect x="0" y="0" width="300" height="200" rx="12" fill="#111"/>`), "root rect painted with radius");
  assert(svg.includes(`<rect x="20" y="20" width="100" height="40" fill="#222" stroke="#333" stroke-width="2"/>`), "child rect at padded origin with stroke");
  assert(count(svg, "<rect") === 2, "unstyled nodes paint nothing");
}

// Text painting: lines from the caller's breaker, textLength, wrapping
{
  const advances = [60, 60, 60];
  const opts = { spaceWidth: 10, lineHeight: 20 };
  const words = ["alpha", "beta", "gamma"];
  const lines = breakLines(advances, opts);
  const leaf = textNode(measureFromAdvances(advances, opts), { id: "text" });
  const tree: LayoutNode = {
    id: "root",
    width: 140,
    height: 100,
    alignItems: "flex-start",
    children: [leaf],
  };
  const result = solveLayout(tree);
  const svg = renderToSvg(tree, result, {
    style: (node) =>
      node.id === "text"
        ? {
            text: {
              lines: (w) => lines(w).map((l) => ({ text: words.slice(l.start, l.end).join(" "), width: l.width })),
              fontFamily: "Arial",
              fontSize: 16,
              lineHeight: 20,
              color: "#abc",
            },
          }
        : undefined,
  });
  assert(count(svg, "<text") === 2, "three words at 130px wrap to two painted lines");
  assert(svg.includes(">alpha beta</text>"), "first line joins its word range");
  assert(svg.includes(">gamma</text>"), "second line carries the overflow word");
  assert(svg.includes(`textLength="130"`), "line width becomes textLength");
  assert(svg.includes(`lengthAdjust="spacingAndGlyphs"`), "textLength adjusts spacing and glyphs");
  assert(svg.includes(`fill="#abc"`), "text color painted");
}

// Baselines: half-leading model when ascent/descent given, ratio fallback otherwise
{
  const leaf = textNode(measureFromAdvances([50], { spaceWidth: 5, lineHeight: 30 }), { id: "t" });
  const tree: LayoutNode = { id: "root", width: 100, height: 50, alignItems: "flex-start", children: [leaf] };
  const result = solveLayout(tree);
  const style = (text: object) => (node: LayoutNode) =>
    node.id === "t"
      ? {
          text: {
            lines: () => [{ text: "hi", width: 50 }],
            fontFamily: "Arial",
            fontSize: 20,
            lineHeight: 30,
            ...text,
          },
        }
      : undefined;
  const halfLeading = renderToSvg(tree, result, { style: style({ ascent: 18, descent: 5 }) });
  assert(halfLeading.includes(`y="21.5"`), "half-leading baseline: (30-23)/2 + 18");
  const fallback = renderToSvg(tree, result, { style: style({}) });
  assert(fallback.includes(`y="20.2"`), "fallback baseline: (30-20)/2 + 20*0.76");
}

// Alignment anchors and XML escaping
{
  const leaf = textNode(() => ({ width: 40, height: 20 }), { id: "t" });
  const tree: LayoutNode = { id: "root", width: 200, height: 20, alignItems: "flex-start", children: [leaf] };
  leaf.width = 200;
  const result = solveLayout(tree);
  const svg = renderToSvg(tree, result, {
    style: (node) =>
      node.id === "t"
        ? {
            text: {
              lines: () => [{ text: "a < b & c", width: 40 }],
              fontFamily: `"My Font", serif`,
              fontSize: 14,
              lineHeight: 20,
              align: "center",
            },
          }
        : undefined,
  });
  assert(svg.includes(`text-anchor="middle"`), "center align anchors middle");
  assert(svg.includes(`x="100"`), "center anchor sits at half the content width");
  assert(svg.includes(">a &lt; b &amp; c</text>"), "text content is XML-escaped");
  assert(svg.includes(`font-family="&quot;My Font&quot;, serif"`), "attribute values are quote-escaped");
}

// defs pass through
{
  const tree: LayoutNode = { id: "root", width: 10, height: 10 };
  const result = solveLayout(tree);
  const svg = renderToSvg(tree, result, {
    style: () => ({ fill: "url(#g)" }),
    defs: `<linearGradient id="g"/>`,
  });
  assert(svg.includes(`<defs><linearGradient id="g"/></defs>`), "defs content is emitted verbatim");
}

// Debug renderer: depth fills, ids, sizes, padding offset
{
  const tree: LayoutNode = {
    id: "root",
    width: 200,
    height: 100,
    padding: 10,
    children: [{ id: "a", width: 80, height: 40 }],
  };
  const result = solveLayout(tree);
  const svg = renderDebugSvg(tree, result);
  assert(svg.includes(`width="248" height="148"`), "canvas adds default 24px padding");
  assert(svg.includes(`>root</text>`) && svg.includes(`>a</text>`), "ids labeled");
  assert(svg.includes(`180×80`), "root content size labeled");
  assert(svg.includes(`fill="#e8d5c4"`), "depth-1 palette fill");
  const bare = renderDebugSvg(tree, result, { showIds: false, showSizes: false, padding: 0 });
  assert(!bare.includes(`>root</text>`) && !bare.includes(`180×80`), "labels can be disabled");
  assert(bare.includes(`width="200" height="100"`), "padding 0 keeps the root size");
}

// Debug renderer: grid track outlines from the trace
{
  const tree: LayoutNode = {
    id: "grid",
    display: "grid",
    width: 220,
    height: 120,
    padding: 10,
    gap: 10,
    gridTemplateColumns: [90, 100],
    gridTemplateRows: [40, 50],
    children: [
      { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
    ],
  };
  const result = solveLayout(tree, { debug: true });
  const svg = renderDebugSvg(tree, result, { trace: result.trace });
  assert(count(svg, `stroke-dasharray="3 3"`) === 4, "two column + two row track outlines");
  assert(svg.includes(`x="134" y="34" width="100" height="100"`), "second column spans the content box at its offset");
  assert(svg.includes(`x="34" y="84" width="200" height="50"`), "second row sits below the first plus gap");
}

console.log(`\n--- SVG Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
