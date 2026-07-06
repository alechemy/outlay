import { parseDocument, ElementType } from "htmlparser2";
import type { AnyNode, ChildNode, Element } from "domhandler";
import type {
  LayoutNode,
  TrackListEntry,
  TrackRepeat,
  TrackSize,
} from "./types.js";

/**
 * Thrown when HTML input contains something outside outlay's supported
 * vocabulary. `path` is a CSS-selector-ish location for the offending element
 * (its `#id` when it has one, else a `tag:nth-child(n)` chain from the root).
 */
export class HTMLParseError extends Error {
  path: string;
  constructor(message: string, path: string) {
    super(path ? `${message} (at ${path})` : message);
    this.name = "HTMLParseError";
    this.path = path;
    Object.setPrototypeOf(this, HTMLParseError.prototype);
  }
}

const KEYWORD_SIZES = new Set(["auto", "min-content", "max-content"]);

const ENUM_PROPS: Record<string, { field: string; values: readonly string[] }> =
  {
    "box-sizing": { field: "boxSizing", values: ["content-box", "border-box"] },
    // A missing `display` sets no field, so it falls to LayoutNode's default of
    // "flex" (not CSS's "block").
    display: { field: "display", values: ["flex", "grid", "block", "none"] },
    "flex-direction": {
      field: "flexDirection",
      values: ["row", "column", "row-reverse", "column-reverse"],
    },
    "flex-wrap": {
      field: "flexWrap",
      values: ["nowrap", "wrap", "wrap-reverse"],
    },
    "justify-content": {
      field: "justifyContent",
      values: [
        "flex-start",
        "flex-end",
        "center",
        "space-between",
        "space-around",
        "space-evenly",
      ],
    },
    "align-items": {
      field: "alignItems",
      values: ["flex-start", "flex-end", "center", "stretch", "baseline"],
    },
    "align-content": {
      field: "alignContent",
      values: [
        "flex-start",
        "flex-end",
        "center",
        "stretch",
        "space-between",
        "space-around",
      ],
    },
    "align-self": {
      field: "alignSelf",
      values: [
        "auto",
        "flex-start",
        "flex-end",
        "center",
        "stretch",
        "baseline",
      ],
    },
    "justify-items": {
      field: "justifyItems",
      values: ["start", "end", "center", "stretch"],
    },
    "justify-self": {
      field: "justifySelf",
      values: ["auto", "start", "end", "center", "stretch"],
    },
    position: {
      field: "position",
      values: ["static", "relative", "absolute", "fixed"],
    },
  };

type Sides<T> = { top?: T; right?: T; bottom?: T; left?: T };

interface LineSpec {
  kind: "auto" | "line" | "span";
  value?: number;
}

export function parseHTML(html: string): LayoutNode {
  const doc = parseDocument(html);
  const roots: Element[] = [];
  for (const child of doc.children) {
    if (isElement(child)) {
      roots.push(child);
    } else if (isText(child) && /\S/.test(child.data)) {
      throw new HTMLParseError(
        `outlay has no text layout; text needs a measureContent callback on a leaf node (found stray text "${snippet(child.data)}" outside the root element)`,
        "",
      );
    }
    // comments, doctype/directives, and whitespace text between roots: ignore
  }
  if (roots.length === 0) {
    throw new HTMLParseError("expected a single root element, found none", "");
  }
  if (roots.length > 1) {
    throw new HTMLParseError(
      `expected a single root element, found ${roots.length}`,
      "",
    );
  }

  const ctx = { usedIds: new Set<string>(), autoCounter: { n: 0 } };
  return convertElement(roots[0], "", true, 1, ctx);
}

interface ConvertContext {
  usedIds: Set<string>;
  autoCounter: { n: number };
}

function convertElement(
  el: Element,
  parentPath: string,
  isRoot: boolean,
  siblingIndex: number,
  ctx: ConvertContext,
): LayoutNode {
  const explicitId =
    typeof el.attribs.id === "string" && el.attribs.id.length > 0
      ? el.attribs.id
      : null;

  const segment = explicitId
    ? `#${explicitId}`
    : isRoot
      ? el.name
      : `${el.name}:nth-child(${siblingIndex})`;
  const path = explicitId
    ? `#${explicitId}`
    : isRoot
      ? segment
      : `${parentPath} > ${segment}`;

  for (const attr of Object.keys(el.attribs)) {
    if (attr !== "id" && attr !== "style") {
      throw new HTMLParseError(
        `unsupported attribute "${attr}"; only "id" and "style" are allowed`,
        path,
      );
    }
  }

  let id: string;
  if (explicitId) {
    if (ctx.usedIds.has(explicitId)) {
      throw new HTMLParseError(
        `duplicate id "${explicitId}"; ids must be unique (result boxes are keyed by id)`,
        path,
      );
    }
    id = explicitId;
  } else {
    id = `node-${++ctx.autoCounter.n}`;
    if (ctx.usedIds.has(id)) {
      throw new HTMLParseError(
        `auto-assigned id "${id}" collides with an explicit id; rename the explicit "${id}" so it does not clash with the auto-id sequence`,
        path,
      );
    }
  }
  ctx.usedIds.add(id);

  const node: LayoutNode = { id };
  applyStyle(node, el.attribs.style, path);

  const children: LayoutNode[] = [];
  let elementIndex = 0;
  for (const child of el.children) {
    if (isElement(child)) {
      elementIndex++;
      children.push(convertElement(child, path, false, elementIndex, ctx));
    } else if (isText(child) && /\S/.test(child.data)) {
      throw new HTMLParseError(
        `outlay has no text layout; text needs a measureContent callback on a leaf node (found text "${snippet(child.data)}")`,
        path,
      );
    }
    // whitespace text and comments: ignore
  }
  if (children.length > 0) node.children = children;

  return node;
}

function applyStyle(
  node: LayoutNode,
  style: string | undefined,
  path: string,
): void {
  if (!style) return;

  const padding: Sides<number> = {};
  const border: Sides<number> = {};
  const margin: Sides<number | "auto"> = {};
  let touchedPadding = false;
  let touchedBorder = false;
  let touchedMargin = false;

  let colStart: LineSpec | undefined;
  let colEnd: LineSpec | undefined;
  let rowStart: LineSpec | undefined;
  let rowEnd: LineSpec | undefined;

  const fail = (message: string): never => {
    throw new HTMLParseError(message, path);
  };

  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) {
      if (decl.trim() !== "") fail(`malformed declaration "${decl.trim()}"`);
      continue;
    }
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const rawValue = decl.slice(idx + 1).trim();
    if (prop === "") continue;
    if (rawValue === "") fail(`property "${prop}" has no value`);
    const value = rawValue.toLowerCase();

    const enumProp = ENUM_PROPS[prop];
    if (enumProp) {
      if (!enumProp.values.includes(value)) {
        fail(
          `"${prop}: ${rawValue}" is not supported; expected one of ${enumProp.values.join(", ")}`,
        );
      }
      (node as unknown as Record<string, unknown>)[enumProp.field] = value;
      continue;
    }

    switch (prop) {
      case "width":
        node.width = parseSize(value, prop, fail);
        break;
      case "height":
        node.height = parseSize(value, prop, fail);
        break;
      case "min-width":
        node.minWidth = parsePx(value, prop, fail, false);
        break;
      case "max-width":
        node.maxWidth = parsePx(value, prop, fail, false);
        break;
      case "min-height":
        node.minHeight = parsePx(value, prop, fail, false);
        break;
      case "max-height":
        node.maxHeight = parsePx(value, prop, fail, false);
        break;

      case "padding":
        Object.assign(
          padding,
          expandSides<number>(splitSpaces(value), prop, fail),
        );
        touchedPadding = true;
        break;
      case "padding-top":
      case "padding-right":
      case "padding-bottom":
      case "padding-left":
        padding[prop.slice(8) as keyof Sides<number>] = parsePx(
          value,
          prop,
          fail,
          false,
        );
        touchedPadding = true;
        break;

      case "margin":
        Object.assign(
          margin,
          expandSides<number | "auto">(splitSpaces(value), prop, fail, true),
        );
        touchedMargin = true;
        break;
      case "margin-top":
      case "margin-right":
      case "margin-bottom":
      case "margin-left":
        margin[prop.slice(7) as keyof Sides<number>] = parseMarginSide(
          value,
          prop,
          fail,
        );
        touchedMargin = true;
        break;

      case "border-width":
        Object.assign(
          border,
          expandSides<number>(splitSpaces(value), prop, fail),
        );
        touchedBorder = true;
        break;
      case "border-top-width":
      case "border-right-width":
      case "border-bottom-width":
      case "border-left-width":
        border[prop.slice(7, -6) as keyof Sides<number>] = parsePx(
          value,
          prop,
          fail,
          false,
        );
        touchedBorder = true;
        break;
      case "border": {
        const w = borderShorthandWidth(value, prop, fail);
        border.top = w;
        border.right = w;
        border.bottom = w;
        border.left = w;
        touchedBorder = true;
        break;
      }
      case "border-top":
      case "border-right":
      case "border-bottom":
      case "border-left":
        border[prop.slice(7) as keyof Sides<number>] = borderShorthandWidth(
          value,
          prop,
          fail,
        );
        touchedBorder = true;
        break;

      case "gap":
        setGap(node, splitSpaces(value), prop, fail);
        break;
      case "row-gap":
        setAxisGap(node, "row", parsePx(value, prop, fail, false));
        break;
      case "column-gap":
        setAxisGap(node, "column", parsePx(value, prop, fail, false));
        break;

      case "flex-grow":
        node.flexGrow = parseFactor(value, prop, fail);
        break;
      case "flex-shrink":
        node.flexShrink = parseFactor(value, prop, fail);
        break;
      case "flex-basis":
        node.flexBasis = parseBasis(value, prop, fail);
        break;
      case "flex":
        applyFlexShorthand(node, value, fail);
        break;
      case "order":
        node.order = parseIntStrict(value, prop, fail);
        break;

      case "grid-template-columns":
        setTemplate(node, "gridTemplateColumns", value, prop, fail);
        break;
      case "grid-template-rows":
        setTemplate(node, "gridTemplateRows", value, prop, fail);
        break;
      case "grid-auto-columns":
        node.gridAutoColumns = parseSingleTrack(value, prop, fail);
        break;
      case "grid-auto-rows":
        node.gridAutoRows = parseSingleTrack(value, prop, fail);
        break;
      case "grid-auto-flow":
        node.gridAutoFlow = parseAutoFlow(value, prop, fail);
        break;

      case "grid-column":
        [colStart, colEnd] = parsePlacementShorthand(value, prop, fail);
        break;
      case "grid-row":
        [rowStart, rowEnd] = parsePlacementShorthand(value, prop, fail);
        break;
      case "grid-column-start":
        colStart = parseLineSpec(value, prop, fail);
        break;
      case "grid-column-end":
        colEnd = parseLineSpec(value, prop, fail);
        break;
      case "grid-row-start":
        rowStart = parseLineSpec(value, prop, fail);
        break;
      case "grid-row-end":
        rowEnd = parseLineSpec(value, prop, fail);
        break;

      case "top":
        node.top = parsePx(value, prop, fail, true);
        break;
      case "right":
        node.right = parsePx(value, prop, fail, true);
        break;
      case "bottom":
        node.bottom = parsePx(value, prop, fail, true);
        break;
      case "left":
        node.left = parsePx(value, prop, fail, true);
        break;

      default:
        fail(`unsupported property "${prop}"`);
    }
  }

  if (touchedPadding) node.padding = padding;
  if (touchedBorder) node.border = border;
  if (touchedMargin) node.margin = margin;

  const col = combinePlacement(colStart, colEnd, "grid-column", fail);
  if (col) node.gridColumn = col;
  const row = combinePlacement(rowStart, rowEnd, "grid-row", fail);
  if (row) node.gridRow = row;
}

function parseSize(
  value: string,
  prop: string,
  fail: (m: string) => never,
): number | "auto" | "min-content" | "max-content" {
  if (KEYWORD_SIZES.has(value)) return value as "auto";
  return parsePx(value, prop, fail, false);
}

function parsePx(
  value: string,
  prop: string,
  fail: (m: string) => never,
  allowNegative: boolean,
): number {
  const n = asPx(value);
  if (n === null) badLength(prop, value, fail);
  if (!allowNegative && n < 0) fail(`"${prop}: ${value}" must not be negative`);
  return n;
}

function parseMarginSide(
  value: string,
  prop: string,
  fail: (m: string) => never,
): number | "auto" {
  if (value === "auto") return "auto";
  return parsePx(value, prop, fail, true);
}

function badLength(
  prop: string,
  value: string,
  fail: (m: string) => never,
): never {
  fail(
    `"${prop}: ${value}" is not a supported length; outlay accepts only <number>px or 0 (no percentages, em/rem/viewport units, calc(), or var())`,
  );
}

function asPx(value: string): number | null {
  const m = /^(-?\d*\.?\d+)px$/.exec(value);
  if (m) return parseFloat(m[1]);
  if (/^-?\d*\.?\d+$/.test(value) && parseFloat(value) === 0) return 0;
  return null;
}

function asNumber(value: string): number | null {
  return /^-?\d*\.?\d+$/.test(value) ? parseFloat(value) : null;
}

function parseFactor(
  value: string,
  prop: string,
  fail: (m: string) => never,
): number {
  const n = asNumber(value);
  if (n === null)
    fail(`"${prop}: ${value}" must be a unitless number`);
  if (n < 0) fail(`"${prop}: ${value}" must be >= 0`);
  return n;
}

function parseIntStrict(
  value: string,
  prop: string,
  fail: (m: string) => never,
): number {
  if (!/^-?\d+$/.test(value)) fail(`"${prop}: ${value}" must be an integer`);
  return parseInt(value, 10);
}

function parseBasis(
  value: string,
  prop: string,
  fail: (m: string) => never,
): number | "auto" | "content" {
  if (value === "auto" || value === "content") return value;
  return parsePx(value, prop, fail, false);
}

function expandSides<T>(
  tokens: string[],
  prop: string,
  fail: (m: string) => never,
  allowAuto = false,
): Sides<T> {
  const parse = (t: string): T =>
    (allowAuto ? parseMarginSide(t, prop, fail) : parsePx(t, prop, fail, false)) as T;
  if (tokens.length < 1 || tokens.length > 4)
    fail(`"${prop}: ${tokens.join(" ")}" must have 1 to 4 values`);
  const v = tokens.map(parse);
  const [t, r = t, b = t, l = r] = v;
  return { top: t, right: r, bottom: b, left: l };
}

function borderShorthandWidth(
  value: string,
  prop: string,
  fail: (m: string) => never,
): number {
  for (const token of splitSpaces(value)) {
    const n = asPx(token);
    if (n !== null) {
      if (n < 0) fail(`"${prop}: ${value}" width must not be negative`);
      return n;
    }
  }
  fail(
    `"${prop}: ${value}" has no px width; the border shorthand must include a <number>px width`,
  );
}

function setGap(
  node: LayoutNode,
  tokens: string[],
  prop: string,
  fail: (m: string) => never,
): void {
  if (tokens.length === 1) {
    node.gap = parsePx(tokens[0], prop, fail, false);
  } else if (tokens.length === 2) {
    node.gap = {
      row: parsePx(tokens[0], prop, fail, false),
      column: parsePx(tokens[1], prop, fail, false),
    };
  } else {
    fail(`"${prop}: ${tokens.join(" ")}" takes one or two values`);
  }
}

function setAxisGap(
  node: LayoutNode,
  axis: "row" | "column",
  value: number,
): void {
  const g = node.gap;
  const row = typeof g === "number" ? g : (g?.row ?? 0);
  const column = typeof g === "number" ? g : (g?.column ?? 0);
  node.gap = axis === "row" ? { row: value, column } : { row, column: value };
}

function applyFlexShorthand(
  node: LayoutNode,
  value: string,
  fail: (m: string) => never,
): void {
  if (value === "none") {
    node.flexGrow = 0;
    node.flexShrink = 0;
    node.flexBasis = "auto";
    return;
  }
  const numbers: number[] = [];
  let basis: number | "auto" | "content" | undefined;
  for (const token of splitSpaces(value)) {
    if (token === "auto" || token === "content") {
      if (basis !== undefined) fail(`"flex: ${value}" has more than one basis`);
      basis = token;
      continue;
    }
    const px = /px$/.test(token) ? asPx(token) : null;
    if (px !== null) {
      if (basis !== undefined) fail(`"flex: ${value}" has more than one basis`);
      if (px < 0) fail(`"flex: ${value}" basis must not be negative`);
      basis = px;
      continue;
    }
    const num = asNumber(token);
    if (num !== null) {
      if (num < 0) fail(`"flex: ${value}" factors must be >= 0`);
      if (numbers.length === 2) fail(`"flex: ${value}" has too many numbers`);
      numbers.push(num);
      continue;
    }
    fail(`"flex: ${value}" has an unsupported component "${token}"`);
  }
  if (numbers.length === 0 && basis === undefined)
    fail(`"flex: ${value}" is empty`);
  node.flexGrow = numbers[0] ?? 1;
  node.flexShrink = numbers[1] ?? 1;
  node.flexBasis = basis ?? 0;
}

function setTemplate(
  node: LayoutNode,
  field: "gridTemplateColumns" | "gridTemplateRows",
  value: string,
  prop: string,
  fail: (m: string) => never,
): void {
  if (value === "none") return;
  const entries = splitSpaces(value).map((t) =>
    parseTrackListEntry(t, prop, fail),
  );
  if (entries.length > 0) node[field] = entries;
}

function parseSingleTrack(
  value: string,
  prop: string,
  fail: (m: string) => never,
): TrackSize {
  const tokens = splitSpaces(value);
  if (tokens.length !== 1)
    fail(`"${prop}: ${value}" takes a single track size`);
  return parseTrackSize(tokens[0], prop, fail);
}

function parseTrackListEntry(
  token: string,
  prop: string,
  fail: (m: string) => never,
): TrackListEntry {
  if (/^repeat\(/i.test(token)) return parseRepeat(token, prop, fail);
  return parseTrackSize(token, prop, fail);
}

function parseRepeat(
  token: string,
  prop: string,
  fail: (m: string) => never,
): TrackRepeat {
  const inner = insideParens(token, "repeat", prop, fail);
  const comma = topLevelIndexOf(inner, ",");
  if (comma === -1)
    fail(`"${prop}: ${token}" — repeat() needs a count and a track list`);
  const countStr = inner.slice(0, comma).trim().toLowerCase();
  const rest = inner.slice(comma + 1).trim();
  let repeat: number | "auto-fill" | "auto-fit";
  if (countStr === "auto-fill" || countStr === "auto-fit") {
    repeat = countStr;
  } else if (/^\d+$/.test(countStr) && parseInt(countStr, 10) >= 1) {
    repeat = parseInt(countStr, 10);
  } else {
    fail(
      `"${prop}: ${token}" — repeat count must be a positive integer, auto-fill, or auto-fit`,
    );
  }
  const tracks = splitSpaces(rest).map((t) => {
    if (/^repeat\(/i.test(t))
      fail(`"${prop}: ${token}" — repeat() cannot be nested`);
    return parseTrackSize(t, prop, fail);
  });
  if (tracks.length === 0)
    fail(`"${prop}: ${token}" — repeat() needs at least one track`);
  return { repeat, tracks };
}

function parseTrackSize(
  token: string,
  prop: string,
  fail: (m: string) => never,
): TrackSize {
  const lower = token.toLowerCase();
  const px = asPx(lower);
  if (px !== null) {
    if (px < 0) fail(`"${prop}: ${token}" track size must not be negative`);
    return px;
  }
  if (KEYWORD_SIZES.has(lower)) return lower as "auto";
  if (isFr(lower)) return normalizeFr(lower);
  if (/^minmax\(/i.test(lower)) return parseMinmax(lower, prop, fail);
  if (/^fit-content\(/i.test(lower))
    fail(`"${prop}: ${token}" — fit-content() is not supported`);
  if (/^repeat\(/i.test(lower))
    fail(`"${prop}: ${token}" — repeat() is not allowed here`);
  if (lower.startsWith("["))
    fail(`"${prop}: ${token}" — named grid lines are not supported`);
  if (lower.includes("%"))
    fail(
      `"${prop}: ${token}" — percentage tracks are not supported; resolve them against the container first`,
    );
  fail(`"${prop}: ${token}" is not a valid track size`);
}

function parseMinmax(
  token: string,
  prop: string,
  fail: (m: string) => never,
): TrackSize {
  const inner = insideParens(token, "minmax", prop, fail);
  const comma = topLevelIndexOf(inner, ",");
  if (comma === -1)
    fail(`"${prop}: ${token}" — minmax() needs two arguments`);
  const a = inner.slice(0, comma).trim().toLowerCase();
  const b = inner.slice(comma + 1).trim().toLowerCase();
  if (topLevelIndexOf(b, ",") !== -1)
    fail(`"${prop}: ${token}" — minmax() takes exactly two arguments`);
  const min = parseMinmaxMin(a, prop, token, fail);
  const max = parseMinmaxMax(b, prop, token, fail);
  return { min, max };
}

function parseMinmaxMin(
  value: string,
  prop: string,
  token: string,
  fail: (m: string) => never,
): number | "auto" | "min-content" | "max-content" {
  const px = asPx(value);
  if (px !== null) {
    if (px < 0) fail(`"${prop}: ${token}" — minmax() min must not be negative`);
    return px;
  }
  if (KEYWORD_SIZES.has(value)) return value as "auto";
  if (isFr(value))
    fail(`"${prop}: ${token}" — an fr value is not allowed as a minmax() min`);
  fail(`"${prop}: ${token}" — "${value}" is not a valid minmax() min`);
}

function parseMinmaxMax(
  value: string,
  prop: string,
  token: string,
  fail: (m: string) => never,
): number | "auto" | `${number}fr` | "min-content" | "max-content" {
  const px = asPx(value);
  if (px !== null) {
    if (px < 0) fail(`"${prop}: ${token}" — minmax() max must not be negative`);
    return px;
  }
  if (KEYWORD_SIZES.has(value)) return value as "auto";
  if (isFr(value)) return normalizeFr(value);
  fail(`"${prop}: ${token}" — "${value}" is not a valid minmax() max`);
}

function parseAutoFlow(
  value: string,
  prop: string,
  fail: (m: string) => never,
): "row" | "column" | "row dense" | "column dense" {
  let axis: "row" | "column" | null = null;
  let dense = false;
  for (const token of splitSpaces(value)) {
    if (token === "dense") {
      dense = true;
    } else if (token === "row" || token === "column") {
      if (axis !== null && axis !== token)
        fail(`"${prop}: ${value}" cannot combine row and column`);
      axis = token;
    } else {
      fail(`"${prop}: ${value}" is not a valid grid-auto-flow`);
    }
  }
  const base = axis ?? "row";
  return dense ? (`${base} dense` as "row dense") : base;
}

function parsePlacementShorthand(
  value: string,
  prop: string,
  fail: (m: string) => never,
): [LineSpec, LineSpec] {
  const parts = value.split("/");
  if (parts.length > 2)
    fail(`"${prop}: ${value}" has too many "/" separators`);
  const start = parseLineSpec(parts[0].trim(), prop, fail);
  const end =
    parts.length === 2
      ? parseLineSpec(parts[1].trim(), prop, fail)
      : { kind: "auto" as const };
  return [start, end];
}

function parseLineSpec(
  value: string,
  prop: string,
  fail: (m: string) => never,
): LineSpec {
  const lower = value.toLowerCase();
  if (lower === "auto") return { kind: "auto" };
  if (lower.startsWith("span")) {
    const rest = lower.slice(4).trim();
    if (!/^\d+$/.test(rest) || parseInt(rest, 10) < 1)
      fail(`"${prop}: ${value}" — span count must be a positive integer`);
    return { kind: "span", value: parseInt(rest, 10) };
  }
  if (/^-?\d+$/.test(lower)) {
    const n = parseInt(lower, 10);
    if (n === 0) fail(`"${prop}: ${value}" — grid line 0 is invalid`);
    return { kind: "line", value: n };
  }
  fail(
    `"${prop}: ${value}" — named grid lines are not supported; use line numbers or "span N"`,
  );
}

function combinePlacement(
  start: LineSpec | undefined,
  end: LineSpec | undefined,
  prop: string,
  fail: (m: string) => never,
): LayoutNode["gridColumn"] | undefined {
  if (start === undefined && end === undefined) return undefined;
  const s = start ?? { kind: "auto" };
  const e = end ?? { kind: "auto" };
  if (s.kind === "auto" && e.kind === "auto") return undefined;

  if (s.kind === "span") {
    if (e.kind === "span")
      fail(`"${prop}" cannot span on both the start and the end line`);
    if (e.kind === "auto") return { start: "auto", end: `span ${s.value!}` };
    if (e.value! <= 0)
      fail(
        `"${prop}: span ${s.value} / ${e.value}" cannot be represented; a spanning start requires a positive end line`,
      );
    const startLine = e.value! - s.value!;
    if (startLine < 1)
      fail(
        `"${prop}: span ${s.value} / ${e.value}" would start before the grid; leading implicit tracks are not supported`,
      );
    return { start: startLine, end: e.value! };
  }

  const startVal = s.kind === "auto" ? ("auto" as const) : s.value!;
  if (e.kind === "span") return { start: startVal, end: `span ${e.value!}` };
  if (e.kind === "auto") return { start: startVal, end: "auto" };
  return { start: startVal, end: e.value! };
}

function insideParens(
  token: string,
  name: string,
  prop: string,
  fail: (m: string) => never,
): string {
  const open = token.indexOf("(");
  if (
    open === -1 ||
    token.slice(0, open).toLowerCase() !== name ||
    !token.endsWith(")")
  ) {
    fail(`"${prop}: ${token}" is not a valid ${name}() value`);
  }
  return token.slice(open + 1, -1);
}

function splitSpaces(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth--;
      cur += ch;
    } else if (depth === 0 && /\s/.test(ch)) {
      if (cur !== "") out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

function topLevelIndexOf(input: string, sep: string): number {
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && ch === sep) return i;
  }
  return -1;
}

function isFr(value: string): boolean {
  return /^\d*\.?\d+fr$/.test(value);
}

function normalizeFr(value: string): `${number}fr` {
  return `${parseFloat(value)}fr`;
}

function snippet(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed;
}

function isElement(node: AnyNode): node is Element {
  return (
    node.type === ElementType.Tag ||
    node.type === ElementType.Script ||
    node.type === ElementType.Style
  );
}

function isText(node: AnyNode): node is ChildNode & { data: string } {
  return node.type === ElementType.Text;
}
