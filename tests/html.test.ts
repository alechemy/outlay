import { parseHTML, HTMLParseError } from "../src/html";
import { validateTree } from "../src/validate";
import { solveLayout } from "../src/solver";
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

function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function assertShape(actual: unknown, expected: unknown, label: string) {
  const a = canon(actual);
  const e = canon(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
  }
}

function catchErr(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

function assertThrows(html: string, label: string, msgIncludes?: string) {
  const e = catchErr(() => parseHTML(html));
  if (!(e instanceof HTMLParseError)) {
    failed++;
    console.error(`  ✗ ${label} — expected HTMLParseError, got ${e}`);
    return;
  }
  if (msgIncludes && !e.message.includes(msgIncludes)) {
    failed++;
    console.error(
      `  ✗ ${label} — message did not mention "${msgIncludes}": ${e.message}`,
    );
    return;
  }
  passed++;
}

const happyTrees: LayoutNode[] = [];

// --- Nested flex layout with shorthands ---
{
  const parsed = parseHTML(`
    <div id="card" style="display: flex; flex-direction: column; padding: 16px; gap: 8px">
      <div id="header" style="height: 40px"></div>
      <div style="flex: 1; margin: 0 auto; padding: 4px 8px 4px 8px"></div>
    </div>
  `);
  assertShape(
    parsed,
    {
      id: "card",
      boxSizing: "content-box",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        { id: "header", boxSizing: "content-box", height: 40 },
        {
          id: "node-1",
          boxSizing: "content-box",
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          padding: { top: 4, right: 8, bottom: 4, left: 8 },
          margin: { top: 0, right: "auto", bottom: 0, left: "auto" },
        },
      ],
    },
    "nested flex layout with shorthands maps to exact tree",
  );
  happyTrees.push(parsed);
}

// --- Grid with minmax, repeat(auto-fill), fr tracks, spans ---
{
  const parsed = parseHTML(`
    <div id="grid" style="display: grid; width: 400px; height: 200px;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      grid-template-rows: 100px auto; gap: 10px 20px">
      <div id="cell" style="grid-column: 1 / span 2; grid-row: 2"></div>
    </div>
  `);
  assertShape(
    parsed,
    {
      id: "grid",
      boxSizing: "content-box",
      display: "grid",
      width: 400,
      height: 200,
      gridTemplateColumns: [
        { repeat: "auto-fill", tracks: [{ min: 200, max: "1fr" }] },
      ],
      gridTemplateRows: [100, "auto"],
      gap: { row: 10, column: 20 },
      children: [
        {
          id: "cell",
          boxSizing: "content-box",
          gridColumn: { start: 1, end: "span 2" },
          gridRow: { start: 2, end: "auto" },
        },
      ],
    },
    "grid with minmax/repeat/fr/span maps to exact tree",
  );
  happyTrees.push(parsed);
}

// fr and keyword minmax tracks
{
  const parsed = parseHTML(
    `<div style="display: grid; grid-template-columns: 1fr 1.5fr minmax(min-content, max-content) auto"></div>`,
  );
  assertShape(
    parsed.gridTemplateColumns,
    ["1fr", "1.5fr", { min: "min-content", max: "max-content" }, "auto"],
    "mixed fr/minmax/auto track list",
  );
}

// repeat(auto-fit) and fixed-count repeat
{
  const parsed = parseHTML(
    `<div style="display: grid; grid-template-columns: repeat(3, 100px); grid-template-rows: repeat(auto-fit, 1fr 2fr)"></div>`,
  );
  assertShape(
    parsed.gridTemplateColumns,
    [{ repeat: 3, tracks: [100] }],
    "fixed-count repeat",
  );
  assertShape(
    parsed.gridTemplateRows,
    [{ repeat: "auto-fit", tracks: ["1fr", "2fr"] }],
    "auto-fit repeat with multiple tracks",
  );
}

// span-only and line/line placements
{
  const parsed = parseHTML(
    `<div style="display: grid"><div id="p1" style="grid-column: span 3"></div><div id="p2" style="grid-column: 2 / 4; grid-row: span 2 / 5"></div></div>`,
  );
  assertShape(
    parsed.children?.[0].gridColumn,
    { start: "auto", end: "span 3" },
    "bare span maps to auto start",
  );
  assertShape(
    parsed.children?.[1].gridColumn,
    { start: 2, end: 4 },
    "line / line placement",
  );
  assertShape(
    parsed.children?.[1].gridRow,
    { start: 3, end: 5 },
    "span N / line resolves to a concrete start line",
  );
}

// --- Auto-id assignment order, mixing explicit + auto ---
{
  const parsed = parseHTML(`
    <div style="display: block; height: 10px">
      <div></div>
      <div id="mid"></div>
      <div></div>
    </div>
  `);
  assert(parsed.id === "node-1", "root without id gets node-1");
  assertShape(
    (parsed.children ?? []).map((c) => c.id),
    ["node-2", "mid", "node-3"],
    "auto ids follow document order and skip explicit ids",
  );
  happyTrees.push(parsed);
}

// --- Border shorthand width extraction ---
{
  const parsed = parseHTML(
    `<div id="b1" style="border: 3px solid #f00; border-left: 5px dashed blue"></div>`,
  );
  assertShape(
    parsed.border,
    { top: 3, right: 3, bottom: 3, left: 5 },
    "border shorthand extracts width; per-side longhand overrides",
  );
  happyTrees.push(parsed);

  const bw = parseHTML(`<div style="border-width: 1px 2px"></div>`);
  assertShape(
    bw.border,
    { top: 1, right: 2, bottom: 1, left: 2 },
    "border-width 2-value shorthand",
  );
}

// gap longhands and single value
{
  assertShape(
    parseHTML(`<div style="gap: 6px"></div>`).gap,
    6,
    "single-value gap is a number",
  );
  assertShape(
    parseHTML(`<div style="row-gap: 4px"></div>`).gap,
    { row: 4, column: 0 },
    "lone row-gap leaves column at 0",
  );
}

// align-content: space-evenly is now accepted
{
  const parsed = parseHTML(
    `<div style="display: flex; flex-wrap: wrap; align-content: space-evenly"></div>`,
  );
  assertShape(
    parsed.alignContent,
    "space-evenly",
    "align-content: space-evenly maps through",
  );
  const errors = validateTree(parsed).filter((i) => i.severity === "error");
  assert(
    errors.length === 0,
    `space-evenly passes validateTree with no errors: ${errors.map((e) => e.message).join("; ")}`,
  );
  happyTrees.push(parsed);
}

// aspect-ratio: plain number and W / H ratio
{
  assertShape(
    parseHTML(`<div style="aspect-ratio: 2"></div>`).aspectRatio,
    2,
    "aspect-ratio plain number",
  );
  assertShape(
    parseHTML(`<div style="aspect-ratio: 0.5"></div>`).aspectRatio,
    0.5,
    "aspect-ratio fractional number",
  );
  assertShape(
    parseHTML(`<div style="aspect-ratio: 16 / 9"></div>`).aspectRatio,
    16 / 9,
    "aspect-ratio W / H ratio",
  );
  assertShape(
    parseHTML(`<div style="aspect-ratio:3/2"></div>`).aspectRatio,
    3 / 2,
    "aspect-ratio ratio without surrounding whitespace",
  );
  happyTrees.push(parseHTML(`<div style="width: 100px; aspect-ratio: 16 / 9"></div>`));
}

// width/height: bare fit-content keyword
{
  assertShape(
    parseHTML(`<div style="width: fit-content"></div>`).width,
    "fit-content",
    "bare fit-content width keyword",
  );
  assertShape(
    parseHTML(`<div style="height: fit-content"></div>`).height,
    "fit-content",
    "bare fit-content height keyword",
  );
}

// grid tracks: fit-content(<px>)
{
  assertShape(
    parseHTML(
      `<div style="display: grid; grid-template-columns: fit-content(200px) 1fr 100px"></div>`,
    ).gridTemplateColumns,
    [{ fitContent: 200 }, "1fr", 100],
    "fit-content(px) among other tracks in a template",
  );
  assertShape(
    parseHTML(
      `<div style="display: grid; grid-auto-rows: fit-content(120px)"></div>`,
    ).gridAutoRows,
    { fitContent: 120 },
    "fit-content(px) as grid-auto-rows",
  );
  assertShape(
    parseHTML(
      `<div style="display: grid; grid-template-columns: repeat(2, fit-content(80px))"></div>`,
    ).gridTemplateColumns,
    [{ repeat: 2, tracks: [{ fitContent: 80 }] }],
    "fit-content(px) inside repeat()",
  );
}

// box-sizing: explicit declarations pass through, absence defaults to content-box
{
  assertShape(
    parseHTML(`<div style="box-sizing: border-box"></div>`).boxSizing,
    "border-box",
    "explicit box-sizing: border-box passes through",
  );
  assertShape(
    parseHTML(`<div style="box-sizing: content-box"></div>`).boxSizing,
    "content-box",
    "explicit box-sizing: content-box passes through",
  );
  assertShape(
    parseHTML(`<div style="width: 10px"></div>`).boxSizing,
    "content-box",
    "absent box-sizing defaults to content-box (CSS default)",
  );
}

// --- Round-trip sanity ---
for (const tree of happyTrees) {
  const errors = validateTree(tree).filter((i) => i.severity === "error");
  assert(
    errors.length === 0,
    `validateTree finds no errors for ${tree.id}: ${errors.map((e) => e.message).join("; ")}`,
  );
  assert(
    catchErr(() => solveLayout(tree)) === null,
    `solveLayout runs without throwing for ${tree.id}`,
  );
}

// --- Percentages: valid on width/height/flex-basis, rejected elsewhere ---
{
  const tree = parseHTML(
    `<div style="display: flex; width: 400px; height: 100px"><div style="width: 50%; height: 25.5%"></div><div style="flex: 1 1 30%"></div><div style="flex-basis: 20%"></div></div>`,
  );
  const kids = tree.children!;
  assert(kids[0].width === "50%", "percentage width maps through");
  assert(kids[0].height === "25.5%", "fractional percentage height maps through");
  assert(kids[1].flexBasis === "30%", "flex shorthand percentage basis maps through");
  assert(kids[2].flexBasis === "20%", "flex-basis percentage maps through");
}
assertThrows(
  `<div style="min-width: 50%"></div>`,
  "percentage min-width throws",
  "percentages",
);
assertThrows(
  `<div style="padding: 10%"></div>`,
  "percentage padding throws",
  "percentages",
);
assertThrows(`<div style="width: 2em"></div>`, "em unit throws", "em/rem");
assertThrows(
  `<div style="width: calc(100% - 10px)"></div>`,
  "calc() throws",
  "calc()",
);
assertThrows(`<div style="width: var(--w)"></div>`, "var() throws", "var()");
assertThrows(
  `<div style="foo: 1px"></div>`,
  "unknown property throws",
  `unsupported property "foo"`,
);
assertThrows(
  `<div class="card"></div>`,
  "class attribute throws",
  `unsupported attribute "class"`,
);
assertThrows(
  `<div>hello world</div>`,
  "non-whitespace text throws",
  "no text layout",
);
assertThrows(`<div></div><div></div>`, "multiple roots throw", "single root");
assertThrows("", "empty input throws", "found none");
assertThrows(
  `<div id="x"><div id="x"></div></div>`,
  "duplicate ids throw",
  `duplicate id "x"`,
);
assertThrows(
  `<div style="display: grid; grid-template-columns: [line1] 100px"></div>`,
  "named grid lines throw",
  "named grid lines",
);
assertThrows(
  `<div style="aspect-ratio: auto"></div>`,
  "aspect-ratio: auto throws",
  "auto is not supported",
);
assertThrows(
  `<div style="aspect-ratio: auto 16 / 9"></div>`,
  "aspect-ratio: auto || ratio throws",
  "auto is not supported",
);
assertThrows(
  `<div style="aspect-ratio: -1"></div>`,
  "negative aspect-ratio throws",
  "positive number",
);
assertThrows(
  `<div style="aspect-ratio: 0"></div>`,
  "zero aspect-ratio throws",
  "positive number",
);
assertThrows(
  `<div style="aspect-ratio: 16 / 0"></div>`,
  "aspect-ratio with a zero component throws",
  "positive number",
);
assertThrows(
  `<div style="aspect-ratio: wide"></div>`,
  "non-numeric aspect-ratio throws",
  "positive number",
);
assertThrows(
  `<div style="width: fit-content(200px)"></div>`,
  "width: fit-content(px) throws",
  "bare fit-content keyword",
);
assertThrows(
  `<div style="display: grid; grid-template-columns: fit-content(50%)"></div>`,
  "fit-content(%) track throws",
  "fit-content()",
);
assertThrows(
  `<div style="display: grid; grid-template-columns: fit-content(min-content)"></div>`,
  "fit-content(keyword) track throws",
  "fit-content()",
);

// --- HTMLParseError.path for a nested failure ---
{
  const e = catchErr(() =>
    parseHTML(
      `<div id="root" style="display:flex"><span></span><div style="width: 2em"></div></div>`,
    ),
  );
  assert(e instanceof HTMLParseError, "nested failure is an HTMLParseError");
  assert(
    (e as HTMLParseError).path === "#root > div:nth-child(2)",
    `nested failure path is the selector chain, got "${(e as HTMLParseError).path}"`,
  );

  const dup = catchErr(() =>
    parseHTML(`<div id="dup"><div id="dup"></div></div>`),
  );
  assert(
    dup instanceof HTMLParseError && dup.path === "#dup",
    `id-carrying element uses its id as the path, got "${(dup as HTMLParseError).path}"`,
  );
}

console.log(`\n--- HTML Converter Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
