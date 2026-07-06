import type { LayoutNode } from "./types.js";

export interface ValidationIssue {
  nodeId: string | null;
  path: string;
  severity: "error" | "warning";
  message: string;
}

const KEYWORD_SIZES = new Set(["auto", "min-content", "max-content"]);

const ENUM_PROPS: Record<string, readonly string[]> = {
  boxSizing: ["content-box", "border-box"],
  display: ["flex", "grid", "block", "none"],
  flexDirection: ["row", "column", "row-reverse", "column-reverse"],
  flexWrap: ["nowrap", "wrap", "wrap-reverse"],
  justifyContent: [
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ],
  alignItems: ["flex-start", "flex-end", "center", "stretch", "baseline"],
  alignContent: [
    "flex-start",
    "flex-end",
    "center",
    "stretch",
    "space-between",
    "space-around",
    "space-evenly",
  ],
  alignSelf: ["auto", "flex-start", "flex-end", "center", "stretch", "baseline"],
  position: ["static", "relative", "absolute", "fixed"],
  gridAutoFlow: ["row", "column", "row dense", "column dense"],
  justifyItems: ["start", "end", "center", "stretch"],
  justifySelf: ["auto", "start", "end", "center", "stretch"],
};

const NUMBER_PROPS = [
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "flexGrow",
  "flexShrink",
  "order",
  "top",
  "right",
  "bottom",
  "left",
] as const;

const KNOWN_KEYS = new Set([
  "id",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "aspectRatio",
  "padding",
  "margin",
  "border",
  "boxSizing",
  "display",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "alignContent",
  "gap",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignSelf",
  "order",
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridAutoRows",
  "gridAutoColumns",
  "gridAutoFlow",
  "justifyItems",
  "gridColumn",
  "gridRow",
  "justifySelf",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "children",
  "measureContent",
]);

const KNOWN_KEYS_NORMALIZED = new Map(
  [...KNOWN_KEYS].map((k) => [k.toLowerCase(), k]),
);

/**
 * Walks a layout tree and reports input the solver does not support (errors)
 * and supported input that hits a documented divergence from browser CSS
 * (warnings). Pure and side-effect free; intended for development and test
 * environments, not the layout hot path.
 */
export function validateTree(root: LayoutNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Map<string, string>();
  visit(root as unknown as Record<string, unknown>, "root", issues, seenIds);
  return issues;
}

function visit(
  node: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
  seenIds: Map<string, string>,
): void {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    issues.push({
      nodeId: null,
      path,
      severity: "error",
      message: `expected a LayoutNode object, got ${node === null ? "null" : Array.isArray(node) ? "an array" : typeof node}`,
    });
    return;
  }

  const id = typeof node.id === "string" && node.id.length > 0 ? node.id : null;
  const err = (message: string) =>
    issues.push({ nodeId: id, path, severity: "error", message });
  const warn = (message: string) =>
    issues.push({ nodeId: id, path, severity: "warning", message });

  if (node.id !== undefined && id === null) {
    err(`"id" must be a non-empty string when provided`);
  } else if (id !== null && seenIds.has(id)) {
    err(
      `duplicate id "${id}" (also at ${seenIds.get(id)}); result boxes are keyed by id, so one node silently overwrites the other`,
    );
  } else if (id !== null) {
    seenIds.set(id, path);
  }

  for (const key of Object.keys(node)) {
    if (!KNOWN_KEYS.has(key)) {
      const suggestion = KNOWN_KEYS_NORMALIZED.get(
        key.toLowerCase().replace(/-/g, ""),
      );
      warn(
        `unknown property "${key}"${suggestion ? ` — did you mean "${suggestion}"?` : ""} (ignored by the solver)`,
      );
    }
  }

  checkSize(node.width, "width", err);
  checkSize(node.height, "height", err);

  for (const prop of NUMBER_PROPS) {
    const v = node[prop];
    if (v !== undefined && !isFiniteNumber(v)) {
      err(`"${prop}" must be a finite number, got ${describe(v)}`);
    }
  }
  if (isFiniteNumber(node.flexGrow) && node.flexGrow < 0) {
    err(`"flexGrow" must be >= 0`);
  }
  if (isFiniteNumber(node.flexShrink) && node.flexShrink < 0) {
    err(`"flexShrink" must be >= 0`);
  }
  if (node.aspectRatio !== undefined) {
    if (!isFiniteNumber(node.aspectRatio) || node.aspectRatio <= 0) {
      err(
        `"aspectRatio" must be a positive finite number, got ${describe(node.aspectRatio)}`,
      );
    }
  }

  checkBoxSides(node.padding, "padding", false, err);
  checkBoxSides(node.border, "border", false, err);
  checkBoxSides(node.margin, "margin", true, err);

  for (const [prop, allowed] of Object.entries(ENUM_PROPS)) {
    const v = node[prop];
    if (v !== undefined && !allowed.includes(v as string)) {
      err(
        `"${prop}" must be one of ${allowed.map((a) => `"${a}"`).join(", ")}, got ${describe(v)}`,
      );
    }
  }

  const flexBasis = node.flexBasis;
  if (
    flexBasis !== undefined &&
    !isFiniteNumber(flexBasis) &&
    flexBasis !== "auto" &&
    flexBasis !== "content"
  ) {
    err(
      `"flexBasis" must be a finite number, "auto", or "content", got ${describe(flexBasis)}${percentageHint(flexBasis)}`,
    );
  }

  checkGap(node.gap, err);
  checkTrackList(node.gridTemplateColumns, "gridTemplateColumns", err);
  checkTrackList(node.gridTemplateRows, "gridTemplateRows", err);
  if (node.gridAutoRows !== undefined && !isValidTrackSize(node.gridAutoRows)) {
    err(`"gridAutoRows" is not a valid track size: ${describe(node.gridAutoRows)}`);
  }
  if (
    node.gridAutoColumns !== undefined &&
    !isValidTrackSize(node.gridAutoColumns)
  ) {
    err(
      `"gridAutoColumns" is not a valid track size: ${describe(node.gridAutoColumns)}`,
    );
  }
  checkGridPlacement(node.gridColumn, "gridColumn", err);
  checkGridPlacement(node.gridRow, "gridRow", err);

  if (node.measureContent !== undefined && typeof node.measureContent !== "function") {
    err(`"measureContent" must be a function, got ${describe(node.measureContent)}`);
  }

  const children = node.children;
  if (children !== undefined && !Array.isArray(children)) {
    err(`"children" must be an array, got ${describe(children)}`);
  }
  const childList = Array.isArray(children) ? children : [];

  const display = typeof node.display === "string" ? node.display : "flex";

  if (
    display === "block" &&
    childList.length > 0 &&
    (node.height === undefined || node.height === "auto")
  ) {
    warn(
      `block containers do not auto-size to their children (height resolves to 0); give this node a definite height`,
    );
  }

  if (display === "block") {
    const collapsible = childList.some((c) => hasVerticalMargin(c));
    if (collapsible) {
      warn(
        `margin collapse is not modeled: vertical margins between block-flow children are summed, where browsers collapse adjacent ones`,
      );
    }
  }

  if (display === "grid") {
    if (node.alignItems === "baseline") {
      warn(`"alignItems: baseline" in a grid container is treated as "start"`);
    }
    for (let i = 0; i < childList.length; i++) {
      const child = childList[i] as Record<string, unknown>;
      if (child && typeof child === "object" && child.alignSelf === "baseline") {
        issues.push({
          nodeId: typeof child.id === "string" ? child.id : null,
          path: `${path}.children[${i}]`,
          severity: "warning",
          message: `"alignSelf: baseline" in a grid container is treated as "start"`,
        });
      }
      if (
        child &&
        typeof child === "object" &&
        (child.position === "absolute" || child.position === "fixed") &&
        (child.gridColumn !== undefined || child.gridRow !== undefined)
      ) {
        issues.push({
          nodeId: typeof child.id === "string" ? child.id : null,
          path: `${path}.children[${i}]`,
          severity: "warning",
          message: `grid placement on an absolutely positioned child is ignored; it positions against the grid container's padding box`,
        });
      }
    }
  }

  if (display === "flex") {
    const mainSizeProp =
      node.flexDirection === "column" || node.flexDirection === "column-reverse"
        ? "height"
        : "width";
    for (let i = 0; i < childList.length; i++) {
      const child = childList[i] as Record<string, unknown>;
      if (
        child &&
        typeof child === "object" &&
        child.flexBasis === "content" &&
        isFiniteNumber(child[mainSizeProp])
      ) {
        issues.push({
          nodeId: typeof child.id === "string" ? child.id : null,
          path: `${path}.children[${i}]`,
          severity: "warning",
          message: `"flexBasis: content" is treated as "auto", so the definite main size wins; in CSS, "content" would ignore it`,
        });
      }
    }
  }

  for (let i = 0; i < childList.length; i++) {
    visit(
      childList[i] as Record<string, unknown>,
      `${path}.children[${i}]`,
      issues,
      seenIds,
    );
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function describe(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number") return String(v);
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return typeof v;
}

function percentageHint(v: unknown): string {
  if (typeof v === "string" && v.trim().endsWith("%")) {
    return `; percentages are not supported — resolve them against the parent's size before building the tree`;
  }
  if (typeof v === "string" && /^\d/.test(v.trim())) {
    return `; use a plain number of pixels, not a CSS string`;
  }
  return "";
}

function checkSize(
  v: unknown,
  prop: string,
  err: (message: string) => void,
): void {
  if (v === undefined || isFiniteNumber(v)) return;
  if (typeof v === "string" && (KEYWORD_SIZES.has(v) || v === "fit-content"))
    return;
  err(
    `"${prop}" must be a finite number, "auto", "min-content", "max-content", or "fit-content", got ${describe(v)}${percentageHint(v)}`,
  );
}

function checkBoxSides(
  v: unknown,
  prop: string,
  allowAuto: boolean,
  err: (message: string) => void,
): void {
  if (v === undefined) return;
  const checkSide = (side: unknown, label: string) => {
    if (allowAuto && side === "auto") return;
    if (!isFiniteNumber(side)) {
      err(
        `"${label}" must be a finite number${allowAuto ? ` or "auto"` : ""}, got ${describe(side)}${percentageHint(side)}`,
      );
    } else if (!allowAuto && side < 0) {
      err(`"${label}" must be >= 0`);
    }
  };
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const sv = (v as Record<string, unknown>)[side];
      if (sv !== undefined) checkSide(sv, `${prop}.${side}`);
    }
    return;
  }
  checkSide(v, prop);
}

function checkGap(v: unknown, err: (message: string) => void): void {
  if (v === undefined) return;
  if (isFiniteNumber(v)) {
    if (v < 0) err(`"gap" must be >= 0`);
    return;
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const axis of ["row", "column"] as const) {
      if (!isFiniteNumber(o[axis]) || (o[axis] as number) < 0) {
        err(`"gap.${axis}" must be a finite number >= 0, got ${describe(o[axis])}`);
      }
    }
    return;
  }
  err(`"gap" must be a number or { row, column }, got ${describe(v)}`);
}

function isValidTrackSize(v: unknown): boolean {
  if (isFiniteNumber(v)) return v >= 0;
  if (typeof v === "string") {
    if (KEYWORD_SIZES.has(v)) return true;
    return isFrString(v);
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ("fitContent" in o) {
      return isFiniteNumber(o.fitContent) && o.fitContent >= 0;
    }
    const minOk =
      (isFiniteNumber(o.min) && o.min >= 0) ||
      o.min === "auto" ||
      o.min === "min-content" ||
      o.min === "max-content";
    const maxOk =
      (isFiniteNumber(o.max) && o.max >= 0) ||
      o.max === "auto" ||
      o.max === "min-content" ||
      o.max === "max-content" ||
      isFrString(o.max);
    return minOk && maxOk;
  }
  return false;
}

function isFrString(v: unknown): boolean {
  return typeof v === "string" && /^\d*\.?\d+fr$/.test(v);
}

function hasVerticalMargin(child: unknown): boolean {
  if (typeof child !== "object" || child === null) return false;
  const m = (child as Record<string, unknown>).margin;
  if (m === undefined) return false;
  if (typeof m === "number") return m !== 0;
  if (typeof m === "object" && m !== null) {
    const o = m as Record<string, unknown>;
    return [o.top, o.bottom].some((s) => s !== undefined && s !== 0);
  }
  return false;
}

function checkTrackList(
  v: unknown,
  prop: string,
  err: (message: string) => void,
): void {
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    err(`"${prop}" must be an array of track sizes, got ${describe(v)}`);
    return;
  }
  v.forEach((entry, i) => {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "repeat" in (entry as Record<string, unknown>)
    ) {
      const rep = entry as Record<string, unknown>;
      const countOk =
        rep.repeat === "auto-fill" ||
        rep.repeat === "auto-fit" ||
        (isFiniteNumber(rep.repeat) &&
          Number.isInteger(rep.repeat) &&
          rep.repeat >= 1);
      if (!countOk) {
        err(
          `"${prop}[${i}].repeat" must be a positive integer, "auto-fill", or "auto-fit", got ${describe(rep.repeat)}`,
        );
      }
      if (!Array.isArray(rep.tracks) || rep.tracks.length === 0) {
        err(`"${prop}[${i}].tracks" must be a non-empty array of track sizes`);
      } else {
        rep.tracks.forEach((t, j) => {
          if (!isValidTrackSize(t)) {
            err(
              `"${prop}[${i}].tracks[${j}]" is not a valid track size: ${describe(t)}${percentageHint(t)}`,
            );
          }
        });
      }
      return;
    }
    if (!isValidTrackSize(entry)) {
      err(
        `"${prop}[${i}]" is not a valid track size: ${describe(entry)}${percentageHint(entry)}`,
      );
    }
  });
}

function checkGridPlacement(
  v: unknown,
  prop: string,
  err: (message: string) => void,
): void {
  if (v === undefined) return;
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    err(`"${prop}" must be an object { start, end }, got ${describe(v)}`);
    return;
  }
  const o = v as Record<string, unknown>;
  const lineOk = (line: unknown) =>
    line === "auto" ||
    (isFiniteNumber(line) && Number.isInteger(line) && line !== 0);
  if (o.start !== undefined && !lineOk(o.start)) {
    err(
      `"${prop}.start" must be a non-zero integer or "auto" (grid lines are 1-based; negative counts from the end), got ${describe(o.start)}`,
    );
  }
  const end = o.end;
  const spanOk =
    typeof end === "string" &&
    /^span [1-9]\d*$/.test(end);
  if (end !== undefined && !lineOk(end) && !spanOk) {
    err(
      `"${prop}.end" must be a non-zero integer, "auto", or "span N", got ${describe(end)}`,
    );
  }
}
