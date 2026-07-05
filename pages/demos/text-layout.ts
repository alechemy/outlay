import type { LayoutNode, ResolvedBox } from "outlay";
import { solveLayout } from "outlay";
import { makeTextMeasure } from "./pretext-adapter";

const FONT = "16px Arial";
const LINE_HEIGHT = 20;

const CARDS = [
  "Off-DOM layout",
  "The solver computes flexbox and grid positions without a browser, the way Pretext extracts text measurement into standalone arithmetic.",
  "Auto rows",
  "Each row is sized to the tallest card once the column widths resolve, so wrapped text drives the track height.",
  "Fractional columns",
  "Three equal fr columns share the free space; narrowing the container rewraps every card and reflows the rows.",
  "Measured, not guessed",
  "Word advances come from Pretext's canvas pass, so the off-DOM result matches Chromium to sub-pixel tolerance.",
  "Zero dependencies",
  "The engine ships no runtime dependencies; Pretext is wired in through the measureContent callback, not bundled.",
];

const measurers = CARDS.map((text) => makeTextMeasure(text, FONT, LINE_HEIGHT));

function buildTree(width: number): LayoutNode {
  return {
    id: "root",
    display: "grid",
    width,
    boxSizing: "border-box",
    padding: 16,
    gap: { row: 12, column: 12 },
    gridTemplateColumns: ["1fr", "1fr", "1fr"],
    children: CARDS.map((_, i) => ({
      id: `card-${i}`,
      boxSizing: "border-box",
      padding: { top: 10, right: 12, bottom: 10, left: 12 },
      border: 1,
      measureContent: measurers[i],
    })),
  };
}

function renderSolver(boxes: Map<string, ResolvedBox>, mismatched: Set<string>) {
  const rootEl = document.getElementById("solver-root")!;
  const rootBox = boxes.get("root")!;
  rootEl.style.width = `${rootBox.borderBoxWidth}px`;
  rootEl.style.height = `${rootBox.borderBoxHeight}px`;
  rootEl.innerHTML = "";
  CARDS.forEach((text, i) => {
    const box = boxes.get(`card-${i}`);
    if (!box) return;
    const el = document.createElement("div");
    el.className = "solver-box" + (mismatched.has(`card-${i}`) ? " mismatch" : "");
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.borderBoxWidth}px`;
    el.style.height = `${box.borderBoxHeight}px`;
    el.style.paddingTop = `${box.padding.top}px`;
    el.style.paddingRight = `${box.padding.right}px`;
    el.style.paddingBottom = `${box.padding.bottom}px`;
    el.style.paddingLeft = `${box.padding.left}px`;
    el.style.borderWidth = `${box.border.top}px`;
    el.textContent = text;
    rootEl.appendChild(el);
  });
}

function renderReference(width: number) {
  const rootEl = document.getElementById("ref-root")!;
  rootEl.style.width = `${width}px`;
  rootEl.style.padding = "16px";
  rootEl.style.gap = "12px";
  rootEl.style.gridTemplateColumns = "1fr 1fr 1fr";
  rootEl.innerHTML = "";
  CARDS.forEach((text, i) => {
    const el = document.createElement("div");
    el.className = "ref-card";
    el.dataset.id = `card-${i}`;
    el.style.padding = "10px 12px";
    el.style.borderWidth = "1px";
    el.style.borderStyle = "solid";
    el.textContent = text;
    rootEl.appendChild(el);
  });
}

function compare(boxes: Map<string, ResolvedBox>): {
  maxDelta: number;
  mismatched: Set<string>;
} {
  const refRoot = document.getElementById("ref-root")!;
  const rootRect = refRoot.getBoundingClientRect();
  const rootStyle = getComputedStyle(refRoot);
  const originX =
    rootRect.left + parseFloat(rootStyle.borderLeftWidth) + parseFloat(rootStyle.paddingLeft);
  const originY =
    rootRect.top + parseFloat(rootStyle.borderTopWidth) + parseFloat(rootStyle.paddingTop);

  const mismatched = new Set<string>();
  let maxDelta = 0;
  CARDS.forEach((_, i) => {
    const id = `card-${i}`;
    const box = boxes.get(id);
    const el = document.querySelector<HTMLElement>(`#ref-root [data-id="${id}"]`);
    if (!box || !el) return;
    const r = el.getBoundingClientRect();
    const deltas = [
      Math.abs(box.x - (r.left - originX)),
      Math.abs(box.y - (r.top - originY)),
      Math.abs(box.borderBoxWidth - r.width),
      Math.abs(box.borderBoxHeight - r.height),
    ];
    for (const d of deltas) {
      maxDelta = Math.max(maxDelta, d);
      if (d > 0.5) mismatched.add(id);
    }
  });
  return { maxDelta, mismatched };
}

function update() {
  const slider = document.getElementById("width") as HTMLInputElement;
  const width = parseInt(slider.value, 10);
  document.getElementById("width-val")!.textContent = `${width}px`;

  const { boxes } = solveLayout(buildTree(width));
  renderReference(width);
  const { maxDelta, mismatched } = compare(boxes);
  renderSolver(boxes, mismatched);

  const badge = document.getElementById("match-status")!;
  if (mismatched.size === 0) {
    badge.className = "ok";
    badge.textContent = `✓ matches browser (max Δ ${maxDelta.toFixed(2)}px)`;
  } else {
    badge.className = "bad";
    badge.textContent = `✗ differs on ${mismatched.size} card(s) (max Δ ${maxDelta.toFixed(2)}px)`;
  }
}

document.getElementById("width")!.addEventListener("input", update);
update();
