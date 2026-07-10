import type { LayoutResult, ResolvedBox } from "outlay";

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

function within(child: ResolvedBox, parent: ResolvedBox): boolean {
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

export function range(start: number, end: number, step: number): number[] {
  const widths: number[] = [];
  for (let w = start; w <= end; w += step) widths.push(w);
  return widths;
}
