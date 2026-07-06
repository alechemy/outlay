import type { LayoutResult, ResolvedBox } from "./types.js";

function requireBox(result: LayoutResult, id: string): ResolvedBox {
  const box = result.boxes.get(id);
  if (!box) {
    const known = [...result.boxes.keys()].join(", ") || "(none)";
    throw new Error(`No box for "${id}". Solver produced: ${known}`);
  }
  return box;
}

/**
 * A box's border-box position relative to its parent's border-box origin
 * (`child.x − parent.x`, `child.y − parent.y`, resolved through `parentId`).
 * The root, which has no parent, reports its own `x`/`y`. Throws a descriptive
 * error when `id` names no box.
 *
 * CSS absolute positioning is relative to the parent's padding box, not its
 * border box; to place an absolutely positioned child, subtract the parent's
 * top/left border from this offset.
 */
export function relativeTo(
  result: LayoutResult,
  id: string,
): { x: number; y: number } {
  const box = requireBox(result, id);
  if (box.parentId === undefined) {
    return { x: box.x, y: box.y };
  }
  const parent = requireBox(result, box.parentId);
  return { x: box.x - parent.x, y: box.y - parent.y };
}

function depthOf(result: LayoutResult, box: ResolvedBox): number {
  let depth = 0;
  let parentId = box.parentId;
  while (parentId !== undefined) {
    depth++;
    parentId = result.boxes.get(parentId)?.parentId;
  }
  return depth;
}

/**
 * The deepest box whose border box contains the point `(x, y)`, or `undefined`
 * when the point lies outside every box.
 *
 * Containment is right/bottom-exclusive: a box contains the point when
 * `box.x <= x < box.x + borderBoxWidth` and likewise on the y axis, so a point
 * on a right or bottom edge belongs to the neighbour, not the box. Depth is the
 * length of the box's `parentId` chain; among equally deep hits the last box in
 * the result's iteration order (emission order, ≈ document order) wins.
 */
export function hitTest(
  result: LayoutResult,
  x: number,
  y: number,
): ResolvedBox | undefined {
  let best: ResolvedBox | undefined;
  let bestDepth = -1;
  for (const box of result.boxes.values()) {
    if (
      x >= box.x &&
      x < box.x + box.borderBoxWidth &&
      y >= box.y &&
      y < box.y + box.borderBoxHeight
    ) {
      const depth = depthOf(result, box);
      if (depth >= bestDepth) {
        best = box;
        bestDepth = depth;
      }
    }
  }
  return best;
}
