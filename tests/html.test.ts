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
      display: "flex",
      flexDirection: "column",
      gap: 8,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        { id: "header", height: 40 },
        {
          id: "node-1",
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

// --- Strictness: every rule throws ---
assertThrows(
  `<div style="width: 50%"></div>`,
  "percentage width throws",
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
  `<div style="display: flex; align-content: space-evenly"></div>`,
  "align-content: space-evenly throws",
  "align-content",
);
assertThrows(
  `<div style="display: grid; grid-template-columns: [line1] 100px"></div>`,
  "named grid lines throw",
  "named grid lines",
);
assertThrows(
  `<div style="display: grid; grid-template-columns: fit-content(100px)"></div>`,
  "fit-content() track throws",
  "fit-content()",
);

// --- HTMLParseError.path for a nested failure ---
{
  const e = catchErr(() =>
    parseHTML(
      `<div id="root" style="display:flex"><span></span><div style="width: 50%"></div></div>`,
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
