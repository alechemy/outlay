import { LayoutNode, LayoutResult, ResolvedBox } from "./types";

export function solveLayout(root: LayoutNode): LayoutResult {
  const result: LayoutResult = {
    boxes: new Map<string, ResolvedBox>(),
  };

  function traverse(node: LayoutNode) {
    const defaultBoxSides = { top: 0, right: 0, bottom: 0, left: 0 };
    result.boxes.set(node.id, {
      id: node.id,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      padding: { ...defaultBoxSides },
      border: { ...defaultBoxSides },
      margin: { ...defaultBoxSides },
      borderBoxWidth: 0,
      borderBoxHeight: 0,
      outerWidth: 0,
      outerHeight: 0,
    });

    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(root);

  return result;
}
