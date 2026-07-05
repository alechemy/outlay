import { describe, expect, test } from "vitest";
import type { LayoutNode } from "../../dist/index.js";
import { overflowsX, range, sweep } from "./helpers.js";

const PAGE_PAD = 16;
const GAP = 16;
const CONTENT_MIN = 440;
const SIDEBAR_OK = 240;
const SIDEBAR_TOO_WIDE = 320;

function appShell(sidebarWidth: number): (width: number) => LayoutNode {
  return (width) => ({
    id: "app",
    display: "flex",
    width,
    padding: PAGE_PAD,
    gap: GAP,
    children: [
      { id: "sidebar", display: "block", width: sidebarWidth, height: 400, flexShrink: 0 },
      { id: "content", display: "block", flexGrow: 1, flexShrink: 1, minWidth: CONTENT_MIN, height: 400 },
    ],
  });
}

const widths = range(768, 1440, 20);

function noHorizontalOverflow(result: Parameters<typeof overflowsX>[0]): void {
  if (overflowsX(result, "app")) {
    throw new Error("the main content is squeezed past the page edge");
  }
}

describe("app shell regression guard", () => {
  test("the shipped sidebar width holds across every desktop width", () => {
    const failures = sweep(widths, appShell(SIDEBAR_OK), noHorizontalOverflow);
    expect(failures).toEqual([]);
  });

  test("widening the sidebar past the threshold is caught by the sweep", () => {
    const failures = sweep(widths, appShell(SIDEBAR_TOO_WIDE), noHorizontalOverflow);
    expect(failures.length).toBeGreaterThan(0);
    expect(Math.min(...failures.map((f) => f.width))).toBe(768);
  });
});
