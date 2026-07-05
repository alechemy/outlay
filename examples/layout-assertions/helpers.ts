import { solveLayout } from "../../dist/index.js";
import type { LayoutNode, LayoutResult, ResolvedBox } from "../../dist/index.js";

const EPSILON = 0.5;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function boxOf(result: LayoutResult, id: string): ResolvedBox {
  const box = result.boxes.get(id);
  if (!box) {
    const known = [...result.boxes.keys()].join(", ") || "(none)";
    throw new Error(`No box for "${id}". Solver produced: ${known}`);
  }
  return box;
}

function borderBox(box: ResolvedBox): Rect {
  return {
    left: box.x,
    top: box.y,
    right: box.x + box.borderBoxWidth,
    bottom: box.y + box.borderBoxHeight,
  };
}

function contentBox(box: ResolvedBox): Rect {
  const left = box.x + box.border.left + box.padding.left;
  const top = box.y + box.border.top + box.padding.top;
  return { left, top, right: left + box.width, bottom: top + box.height };
}

export function overlaps(a: ResolvedBox, b: ResolvedBox): boolean {
  const ra = borderBox(a);
  const rb = borderBox(b);
  const xOverlap = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
  const yOverlap = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  return xOverlap > EPSILON && yOverlap > EPSILON;
}

export function assertNoOverlaps(result: LayoutResult, ids: string[]): void {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = boxOf(result, ids[i]);
      const b = boxOf(result, ids[j]);
      if (overlaps(a, b)) {
        throw new Error(`"${ids[i]}" overlaps "${ids[j]}"`);
      }
    }
  }
}

export function within(child: ResolvedBox, parent: ResolvedBox): boolean {
  const c = borderBox(child);
  const p = contentBox(parent);
  return (
    c.left >= p.left - EPSILON &&
    c.right <= p.right + EPSILON &&
    c.top >= p.top - EPSILON &&
    c.bottom <= p.bottom + EPSILON
  );
}

export function assertContained(
  result: LayoutResult,
  parentId: string,
  childIds: string[],
): void {
  const parent = boxOf(result, parentId);
  for (const id of childIds) {
    const child = boxOf(result, id);
    if (!within(child, parent)) {
      throw new Error(`"${id}" escapes the content box of "${parentId}"`);
    }
  }
}

/** Every other box is treated as a descendant, so pass a container that encloses the subtree under test (e.g. the page root). */
export function overflowsX(result: LayoutResult, parentId: string): boolean {
  const p = contentBox(boxOf(result, parentId));
  for (const [id, box] of result.boxes) {
    if (id === parentId) continue;
    const b = borderBox(box);
    if (b.left < p.left - EPSILON || b.right > p.right + EPSILON) return true;
  }
  return false;
}

export function overflowsY(result: LayoutResult, parentId: string): boolean {
  const p = contentBox(boxOf(result, parentId));
  for (const [id, box] of result.boxes) {
    if (id === parentId) continue;
    const b = borderBox(box);
    if (b.top < p.top - EPSILON || b.bottom > p.bottom + EPSILON) return true;
  }
  return false;
}

export interface SweepFailure {
  width: number;
  message: string;
}

export function sweep(
  widths: number[],
  buildTree: (width: number) => LayoutNode,
  invariant: (result: LayoutResult, width: number) => void,
): SweepFailure[] {
  const failures: SweepFailure[] = [];
  for (const width of widths) {
    const result = solveLayout(buildTree(width));
    try {
      invariant(result, width);
    } catch (error) {
      failures.push({
        width,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return failures;
}

export function range(start: number, end: number, step: number): number[] {
  const widths: number[] = [];
  for (let w = start; w <= end; w += step) widths.push(w);
  return widths;
}
