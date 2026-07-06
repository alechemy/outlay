import { solveLayout } from "./solver.js";
import type { LayoutNode, LayoutResult, ResolvedBox } from "./types.js";

function requireBox(result: LayoutResult, id: string): ResolvedBox {
  const box = result.boxes.get(id);
  if (!box) {
    const known = [...result.boxes.keys()].join(", ") || "(none)";
    throw new Error(`No box for "${id}". Solver produced: ${known}`);
  }
  return box;
}

/**
 * Solves `buildTree(width)` at each width and records the errors thrown by
 * `invariant`. Returns one entry per failing width; an empty array means the
 * invariant held across the whole sweep. `invariant` signals a failure by
 * throwing (e.g. via the assertion helpers below).
 */
export function sweep(
  widths: number[],
  buildTree: (width: number) => LayoutNode,
  invariant: (result: LayoutResult, width: number) => void,
): { width: number; error: Error }[] {
  const failures: { width: number; error: Error }[] = [];
  for (const width of widths) {
    const result = solveLayout(buildTree(width));
    try {
      invariant(result, width);
    } catch (error) {
      failures.push({
        width,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return failures;
}

function borderBoxesOverlap(a: ResolvedBox, b: ResolvedBox): boolean {
  const xOverlap =
    Math.min(a.x + a.borderBoxWidth, b.x + b.borderBoxWidth) -
    Math.max(a.x, b.x);
  const yOverlap =
    Math.min(a.y + a.borderBoxHeight, b.y + b.borderBoxHeight) -
    Math.max(a.y, b.y);
  return xOverlap > 0 && yOverlap > 0;
}

/**
 * Throws on the first pair of boxes whose border boxes overlap, naming both.
 * Overlap is a strict intersection: boxes that only touch along an edge do not
 * count.
 *
 * With `ids`, every unordered pair among those ids is compared. Without them,
 * only siblings — boxes that share a `parentId` — are compared, so a parent
 * enclosing its own child is never reported as an overlap.
 */
export function assertNoOverlaps(result: LayoutResult, ids?: string[]): void {
  if (ids) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = requireBox(result, ids[i]!);
        const b = requireBox(result, ids[j]!);
        if (borderBoxesOverlap(a, b)) {
          throw new Error(`"${ids[i]}" overlaps "${ids[j]}"`);
        }
      }
    }
    return;
  }
  const siblingGroups = new Map<string, ResolvedBox[]>();
  for (const box of result.boxes.values()) {
    if (box.parentId === undefined) continue;
    const group = siblingGroups.get(box.parentId);
    if (group) {
      group.push(box);
    } else {
      siblingGroups.set(box.parentId, [box]);
    }
  }
  for (const siblings of siblingGroups.values()) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i]!;
        const b = siblings[j]!;
        if (borderBoxesOverlap(a, b)) {
          throw new Error(`"${a.id}" overlaps "${b.id}"`);
        }
      }
    }
  }
}

function isDescendantOf(
  result: LayoutResult,
  box: ResolvedBox,
  containerId: string,
): boolean {
  let parentId = box.parentId;
  while (parentId !== undefined) {
    if (parentId === containerId) return true;
    parentId = result.boxes.get(parentId)?.parentId;
  }
  return false;
}

/**
 * True when any descendant of `containerId` has a border box that extends past
 * the container's border box on the x axis (its left edge sits left of the
 * container, or its right edge sits right of it). Descendants are found by
 * walking `parentId` chains.
 */
export function overflowsX(result: LayoutResult, containerId: string): boolean {
  const container = requireBox(result, containerId);
  const left = container.x;
  const right = container.x + container.borderBoxWidth;
  for (const box of result.boxes.values()) {
    if (!isDescendantOf(result, box, containerId)) continue;
    if (box.x < left || box.x + box.borderBoxWidth > right) return true;
  }
  return false;
}

/**
 * True when any descendant of `containerId` has a border box that extends past
 * the container's border box on the y axis (its top edge sits above the
 * container, or its bottom edge sits below it). Descendants are found by
 * walking `parentId` chains.
 */
export function overflowsY(result: LayoutResult, containerId: string): boolean {
  const container = requireBox(result, containerId);
  const top = container.y;
  const bottom = container.y + container.borderBoxHeight;
  for (const box of result.boxes.values()) {
    if (!isDescendantOf(result, box, containerId)) continue;
    if (box.y < top || box.y + box.borderBoxHeight > bottom) return true;
  }
  return false;
}
