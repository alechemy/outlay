import { validateTree } from "../src/validate";
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

function issuesOf(node: LayoutNode) {
  return validateTree(node);
}

function messages(node: LayoutNode): string {
  return issuesOf(node)
    .map((i) => `${i.severity}:${i.message}`)
    .join("\n");
}

// Valid tree produces no issues
{
  const issues = issuesOf({
    id: "root",
    display: "grid",
    width: 400,
    height: 300,
    gap: { row: 8, column: 14 },
    gridTemplateColumns: [240, "auto", "1.5fr", { min: 100, max: "1fr" }],
    gridTemplateRows: [{ repeat: "auto-fill", tracks: [{ min: 40, max: "max-content" }] }],
    children: [
      {
        id: "a",
        gridColumn: { start: 1, end: "span 2" },
        gridRow: { start: -1, end: "auto" },
        margin: { left: "auto" },
        measureContent: () => ({ width: 10, height: 10 }),
      },
      { id: "b", display: "flex", flexDirection: "column", children: [{ id: "c", flexGrow: 1 }] },
    ],
  });
  assert(issues.length === 0, `valid tree has no issues, got:\n${issues.map((i) => i.message).join("\n")}`);
}

// Duplicate ids
{
  const issues = issuesOf({
    id: "root",
    children: [{ id: "x" }, { id: "x" }],
  });
  assert(
    issues.some((i) => i.severity === "error" && i.message.includes(`duplicate id "x"`)),
    "duplicate id is an error",
  );
  assert(
    issues.some((i) => i.path === "root.children[1]"),
    "duplicate id names the second occurrence's path",
  );
}

// Missing id is allowed (auto-assigned by the solver)
assert(
  issuesOf({ children: [] } as LayoutNode).length === 0,
  "missing id is not an issue",
);

// Empty-string id is still an error
assert(
  issuesOf({ id: "" } as LayoutNode).some(
    (i) =>
      i.severity === "error" &&
      i.message.includes(`"id" must be a non-empty string`),
  ),
  "empty id is an error",
);

// Percentage and CSS-string sizes
assert(
  issuesOf({
    id: "r",
    width: 200,
    height: 100,
    children: [{ id: "c", width: "50%", height: "25.5%", flexBasis: "30%" }],
  }).length === 0,
  "percentage width/height/flexBasis are valid on flex children",
);
assert(
  messages({ id: "r", width: "100px" as never }).includes("not a CSS string"),
  "px string width gets the CSS-string hint",
);
assert(
  messages({ id: "r", minWidth: "50%" as never }).includes("percentages are not supported"),
  "percentage minWidth still gets the dedicated hint",
);

// NaN and bad enums
assert(
  messages({ id: "r", minWidth: NaN }).includes(`"minWidth" must be a finite number`),
  "NaN minWidth is an error",
);
assert(
  messages({ id: "r", justifyContent: "start" as never }).includes(`"justifyContent" must be one of`),
  "unsupported justifyContent value is an error",
);
assert(
  messages({ id: "r", flexGrow: -1 }).includes(`"flexGrow" must be >= 0`),
  "negative flexGrow is an error",
);

// Unknown keys with suggestions
{
  const msg = messages({ id: "r", "flex-direction": "row" } as never);
  assert(
    msg.includes(`unknown property "flex-direction"`) && msg.includes(`did you mean "flexDirection"`),
    "hyphenated key suggests the camelCase property",
  );
}
assert(
  messages({ id: "r", flexdirection: "row" } as never).includes(`did you mean "flexDirection"`),
  "case-mangled key suggests the real property",
);

// Box sides
assert(
  messages({ id: "r", padding: -4 }).includes(`"padding" must be >= 0`),
  "negative padding is an error",
);
assert(
  messages({ id: "r", padding: "auto" as never }).includes(`"padding" must be a finite number`),
  "padding auto is an error",
);
assert(
  issuesOf({ id: "r", margin: { top: "auto", left: 3 } }).length === 0,
  "margin auto per side is valid",
);

// Gap
assert(
  messages({ id: "r", gap: { row: 4 } as never }).includes(`"gap.column" must be a finite number`),
  "partial gap object is an error",
);

// Track lists
assert(
  messages({ id: "r", display: "grid", gridTemplateColumns: [-10] }).includes("not a valid track size"),
  "negative track size is an error",
);
assert(
  messages({ id: "r", display: "grid", gridTemplateColumns: ["2 fr" as never] }).includes("not a valid track size"),
  "malformed fr string is an error",
);
assert(
  messages({ id: "r", display: "grid", gridTemplateColumns: ["50%" as never] }).includes("percentages are not supported"),
  "percentage track gets the dedicated hint",
);
assert(
  messages({
    id: "r",
    display: "grid",
    gridTemplateColumns: [{ repeat: 0, tracks: [100] }],
  }).includes(`"gridTemplateColumns[0].repeat" must be a positive integer`),
  "repeat count 0 is an error",
);

// Grid placement
assert(
  messages({ id: "r", gridColumn: { start: 0, end: "auto" } }).includes(`"gridColumn.start" must be a non-zero integer`),
  "grid line 0 is an error",
);
assert(
  messages({ id: "r", gridRow: { start: 1, end: "span 0" as never } }).includes(`"gridRow.end" must be`),
  "span 0 is an error",
);

// measureContent
assert(
  messages({ id: "r", measureContent: { width: 1, height: 1 } as never }).includes(`"measureContent" must be a function`),
  "non-function measureContent is an error",
);

// children shape
assert(
  messages({ id: "r", children: {} as never }).includes(`"children" must be an array`),
  "non-array children is an error",
);

// Non-goal warnings
{
  const issues = issuesOf({
    id: "r",
    display: "block",
    children: [{ id: "c", height: 20 }],
  });
  assert(
    issues.some((i) => i.severity === "warning" && i.message.includes("block containers do not auto-size")),
    "block container without definite height warns",
  );
}
assert(
  issuesOf({ id: "r", display: "block", height: 100, children: [{ id: "c", height: 20 }] }).every(
    (i) => !i.message.includes("auto-size"),
  ),
  "block container with definite height does not warn about auto-size",
);
{
  const issues = issuesOf({
    id: "r",
    display: "block",
    height: 100,
    children: [{ id: "c", height: 20, margin: { top: 10 } }],
  });
  assert(
    issues.some((i) => i.message.includes("margin collapse is not modeled")),
    "vertical margins in block flow warn about collapse",
  );
}
assert(
  issuesOf({ id: "r", display: "grid", alignItems: "baseline", height: 10 }).some(
    (i) => i.severity === "warning" && i.message.includes(`treated as "start"`),
  ),
  "grid baseline alignItems warns",
);
{
  const issues = issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [100],
    children: [{ id: "c", position: "absolute", gridColumn: { start: 1, end: 2 } }],
  });
  assert(
    issues.some((i) => i.message.includes("absolutely positioned child is ignored")),
    "grid placement on absolute child warns",
  );
}
assert(
  issuesOf({ id: "r", children: [{ id: "c", flexBasis: "content", width: 100 }] }).some(
    (i) => i.severity === "warning" && i.message.includes(`"flexBasis: content" is treated as "auto"`),
  ),
  "flexBasis content with definite size warns",
);
assert(
  issuesOf({
    id: "r",
    flexDirection: "row",
    children: [{ id: "c", flexBasis: "content", width: 100 }],
  }).some(
    (i) => i.severity === "warning" && i.message.includes(`"flexBasis: content" is treated as "auto"`),
  ),
  "flexBasis content with definite width warns in a row container",
);
assert(
  issuesOf({
    id: "r",
    flexDirection: "column",
    children: [{ id: "c", flexBasis: "content", height: 100 }],
  }).some(
    (i) => i.severity === "warning" && i.message.includes(`"flexBasis: content" is treated as "auto"`),
  ),
  "flexBasis content with definite height warns in a column container",
);
assert(
  issuesOf({ id: "r", children: [{ id: "c", flexBasis: "content" }] }).every(
    (i) => !i.message.includes(`"flexBasis: content" is treated as "auto"`),
  ),
  "flexBasis content with no definite main size does not warn",
);
assert(
  issuesOf({
    id: "r",
    flexDirection: "column",
    children: [{ id: "c", flexBasis: "content", width: 100 }],
  }).every(
    (i) => !i.message.includes(`"flexBasis: content" is treated as "auto"`),
  ),
  "flexBasis content with a definite cross-axis size does not warn",
);

// order on a grid child
assert(
  issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [100],
    children: [{ id: "c", order: 2 }],
  }).some(
    (i) =>
      i.severity === "warning" &&
      i.message.includes(`"order" is ignored by grid auto-placement`),
  ),
  "order on a grid child warns",
);
assert(
  issuesOf({
    id: "r",
    display: "flex",
    children: [{ id: "c", order: 2 }],
  }).every(
    (i) => !i.message.includes(`"order" is ignored by grid auto-placement`),
  ),
  "order on a flex child does not warn",
);

// fit-content track inside repeat()
assert(
  issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [{ repeat: 2, tracks: [{ fitContent: 100 }] }],
  }).some(
    (i) =>
      i.severity === "warning" &&
      i.message.includes("fit-content track inside repeat()"),
  ),
  "fit-content track inside repeat warns",
);
assert(
  issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [{ fitContent: 100 }, 200],
  }).every((i) => !i.message.includes("fit-content track inside repeat()")),
  "fit-content track outside repeat does not warn",
);

// fit-content cross size in a wrap container
assert(
  issuesOf({
    id: "r",
    display: "flex",
    flexWrap: "wrap",
    children: [{ id: "c", height: "fit-content" }],
  }).some(
    (i) =>
      i.severity === "warning" &&
      i.message.includes(`"height: fit-content" (cross axis) in a wrap container`),
  ),
  "fit-content cross size in a wrap container warns",
);
assert(
  issuesOf({
    id: "r",
    display: "flex",
    flexDirection: "column",
    flexWrap: "wrap",
    height: 100,
    children: [{ id: "c", width: "fit-content" }],
  }).some(
    (i) =>
      i.message.includes(`"width: fit-content" (cross axis) in a wrap container`),
  ),
  "fit-content cross size (width) in a column wrap container warns",
);
assert(
  issuesOf({
    id: "r",
    display: "flex",
    flexWrap: "wrap",
    children: [{ id: "c", width: "fit-content" }],
  }).every((i) => !i.message.includes("(cross axis) in a wrap container")),
  "fit-content main size in a wrap container does not warn",
);
assert(
  issuesOf({
    id: "r",
    display: "flex",
    children: [{ id: "c", height: "fit-content" }],
  }).every((i) => !i.message.includes("(cross axis) in a wrap container")),
  "fit-content cross size in a non-wrap container does not warn",
);

// aspect-ratio item likely placed into an implicit grid track
assert(
  issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [100, 100],
    children: [{ id: "a", aspectRatio: 1 }, { id: "b" }, { id: "c" }],
  }).some(
    (i) =>
      i.severity === "warning" &&
      i.message.includes("may be placed into an implicit"),
  ),
  "aspect-ratio child beyond explicit cells warns",
);
assert(
  issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [{ repeat: "auto-fill", tracks: [100] }],
    children: [{ id: "a", aspectRatio: 1 }, { id: "b" }, { id: "c" }],
  }).every((i) => !i.message.includes("may be placed into an implicit")),
  "aspect-ratio with auto-fill repeat does not warn",
);
assert(
  issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [100, 100],
    children: [{ id: "a", aspectRatio: 1 }, { id: "b" }],
  }).every((i) => !i.message.includes("may be placed into an implicit")),
  "aspect-ratio within explicit cells does not warn",
);
assert(
  issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [100, 100],
    children: [{ id: "a" }, { id: "b" }, { id: "c" }],
  }).every((i) => !i.message.includes("may be placed into an implicit")),
  "extra children without aspect-ratio do not warn",
);

// Keyword min/max sizes
assert(
  issuesOf({
    id: "r",
    minWidth: "max-content",
    maxWidth: "max-content",
    minHeight: "min-content",
    maxHeight: "max-content",
  }).length === 0,
  "keyword min/max sizes are valid",
);
assert(
  messages({ id: "r", minWidth: "fit-content" as never }).includes(
    `"minWidth" must be a finite number, "min-content", or "max-content"`,
  ),
  "fit-content as a min/max size is an error",
);

// Percentage boundary warnings
assert(
  issuesOf({ id: "r", width: "50%" }).some(
    (i) => i.severity === "warning" && i.message.includes("has no containing block"),
  ),
  "percentage size on the root warns",
);
assert(
  issuesOf({
    id: "r",
    display: "grid",
    gridTemplateColumns: [100],
    height: 50,
    children: [{ id: "c", width: "50%" }],
  }).some(
    (i) => i.severity === "warning" && i.message.includes("percentage sizes on grid children"),
  ),
  "percentage size on a grid child warns",
);
assert(
  issuesOf({
    id: "r",
    width: 200,
    height: 50,
    children: [{ id: "c", width: "50%" }],
  }).every((i) => !i.message.includes("percentage")),
  "percentage size on a flex child does not warn",
);

console.log(`\n--- Validate Tests ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
