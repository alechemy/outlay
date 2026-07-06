import type { LayoutNode, ResolvedBox } from "outlay";
import { solveLayout } from "outlay";
import { parseHTML, HTMLParseError } from "../../src/html";
import { colorAt } from "./palette";

const PRESETS: Record<string, string> = {
  seed: `<div id="app" style="display: grid; grid-template-columns: fit-content(200px) 1fr 1fr 1fr; gap: 14px; width: 720px; padding: 18px">
  <div id="sidebar" style="display: flex; flex-direction: column; gap: 10px; width: 180px; grid-column: 1 / 2; grid-row: 1 / 3">
    <div id="logo" style="display: flex; width: 120px; height: 40px"></div>
    <div id="nav-1" style="display: flex; height: 30px"></div>
    <div id="nav-2" style="display: flex; height: 30px"></div>
    <div id="nav-3" style="display: flex; height: 30px"></div>
  </div>
  <div id="card-1" style="display: flex; aspect-ratio: 3 / 2; grid-column: 2 / 3; grid-row: 1 / 2"></div>
  <div id="card-2" style="display: flex; aspect-ratio: 3 / 2; grid-column: 3 / 4; grid-row: 1 / 2"></div>
  <div id="card-3" style="display: flex; aspect-ratio: 3 / 2; grid-column: 4 / 5; grid-row: 1 / 2"></div>
  <div id="card-4" style="display: flex; aspect-ratio: 3 / 2; grid-column: 2 / 3; grid-row: 2 / 3"></div>
  <div id="card-5" style="display: flex; aspect-ratio: 3 / 2; grid-column: 3 / 4; grid-row: 2 / 3"></div>
  <div id="card-6" style="display: flex; aspect-ratio: 3 / 2; grid-column: 4 / 5; grid-row: 2 / 3"></div>
</div>`,

  flex: `<div id="bar" style="display: flex; align-items: stretch; gap: 12px; width: 640px; height: 220px; padding: 16px">
  <div id="rail" style="display: flex; flex-direction: column; gap: 8px; width: 25%">
    <div id="avatar" style="display: flex; height: 48px"></div>
    <div id="handle" style="display: flex; flex-grow: 1"></div>
  </div>
  <div id="feed" style="display: flex; flex-direction: column; gap: 10px; flex-grow: 1">
    <div id="post-1" style="display: flex; height: 40px"></div>
    <div id="post-2" style="display: flex; flex-grow: 1"></div>
  </div>
  <div id="aside" style="display: flex; width: 15%"></div>
</div>`,

  grid: `<div id="board" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); grid-auto-rows: 72px; gap: 12px; width: 560px; padding: 16px">
  <div id="t1" style="display: flex"></div>
  <div id="t2" style="display: flex"></div>
  <div id="t3" style="display: flex"></div>
  <div id="t4" style="display: flex"></div>
  <div id="t5" style="display: flex"></div>
  <div id="t6" style="display: flex"></div>
  <div id="t7" style="display: flex"></div>
  <div id="t8" style="display: flex"></div>
</div>`,

  invalid: `<div id="settings" style="display: flex; gap: 12px; width: 520px; padding: 16px">
  <div id="menu" style="display: flex; flex-direction: column; gap: 8px; width: 160px">
    <div style="display: flex; height: 34px"></div>
    <div style="display: flex; width: 50em; height: 34px"></div>
  </div>
  <div id="body" style="display: flex; flex-grow: 1; height: 120px"></div>
</div>`,
};

const source = document.getElementById("source") as HTMLTextAreaElement;
const solverRoot = document.getElementById("solver-root")!;
const browserHost = document.getElementById("browser-host")!;
const badge = document.getElementById("match-status")!;
const panes = document.getElementById("panes")!;
const errorPanel = document.getElementById("error-panel")!;
const errorTitle = document.getElementById("error-title")!;
const errorPathRow = document.getElementById("error-path-row")!;
const errorPath = document.getElementById("error-path")!;
const errorMessage = document.getElementById("error-message")!;

interface Compared {
  mismatched: Set<string>;
  maxDelta: number;
}

function renderBrowser(html: string): void {
  browserHost.innerHTML = html;
  const root = browserHost.firstElementChild as HTMLElement | null;
  const paint = (el: HTMLElement, depth: number) => {
    el.style.background = colorAt(depth);
    el.style.outline = "1px solid rgba(0, 0, 0, 0.14)";
    el.style.outlineOffset = "-1px";
    for (const child of el.children) paint(child as HTMLElement, depth + 1);
  };
  if (root) paint(root, 0);
}

function compare(tree: LayoutNode, boxes: Map<string, ResolvedBox>): Compared {
  const rootEl = browserHost.firstElementChild as HTMLElement | null;
  const rootBox = boxes.get(tree.id!);
  const mismatched = new Set<string>();
  let maxDelta = 0;
  if (!rootEl || !rootBox) return { mismatched, maxDelta };
  const rootRect = rootEl.getBoundingClientRect();

  const walk = (node: LayoutNode, el: Element | undefined) => {
    const box = boxes.get(node.id!);
    if (box && el) {
      const r = el.getBoundingClientRect();
      const deltas = [
        Math.abs(box.x - rootBox.x - (r.left - rootRect.left)),
        Math.abs(box.y - rootBox.y - (r.top - rootRect.top)),
        Math.abs(box.borderBoxWidth - r.width),
        Math.abs(box.borderBoxHeight - r.height),
      ];
      for (const d of deltas) {
        maxDelta = Math.max(maxDelta, d);
        if (d > 0.5) mismatched.add(node.id!);
      }
    }
    const children = node.children ?? [];
    const elChildren = el ? el.children : ([] as unknown as HTMLCollection);
    children.forEach((child, i) => walk(child, elChildren[i]));
  };
  walk(tree, rootEl);
  return { mismatched, maxDelta };
}

function renderSolver(
  tree: LayoutNode,
  boxes: Map<string, ResolvedBox>,
  mismatched: Set<string>,
): void {
  solverRoot.innerHTML = "";
  const rootBox = boxes.get(tree.id!);
  if (!rootBox) return;
  solverRoot.style.width = `${rootBox.borderBoxWidth}px`;
  solverRoot.style.height = `${rootBox.borderBoxHeight}px`;

  const walk = (node: LayoutNode, depth: number) => {
    const box = boxes.get(node.id!);
    if (box) {
      const el = document.createElement("div");
      el.className = "solver-box" + (mismatched.has(node.id!) ? " mismatch" : "");
      el.style.left = `${box.x - rootBox.x}px`;
      el.style.top = `${box.y - rootBox.y}px`;
      el.style.width = `${box.borderBoxWidth}px`;
      el.style.height = `${box.borderBoxHeight}px`;
      el.style.background = colorAt(depth);
      const label = document.createElement("span");
      label.className = "box-label";
      label.textContent = node.id!;
      el.appendChild(label);
      solverRoot.appendChild(el);
    }
    (node.children ?? []).forEach((child) => walk(child, depth + 1));
  };
  walk(tree, 0);
}

function setMatchBadge({ mismatched, maxDelta }: Compared): void {
  if (mismatched.size === 0) {
    badge.className = "ok";
    badge.textContent = `✓ matches browser (max Δ ${maxDelta.toFixed(2)}px)`;
  } else {
    badge.className = "bad";
    const ids = [...mismatched];
    badge.textContent = `✗ differs: ${ids.slice(0, 3).join(", ")}${
      ids.length > 3 ? "…" : ""
    } (max Δ ${maxDelta.toFixed(1)}px)`;
  }
}

function showError(e: unknown): void {
  const isParse = e instanceof HTMLParseError;
  const path = isParse ? e.path : "";
  errorTitle.textContent = isParse ? "HTMLParseError" : "Error";
  if (path) {
    errorPathRow.style.display = "";
    errorPath.textContent = path;
  } else {
    errorPathRow.style.display = "none";
  }
  const raw = e instanceof Error ? e.message : String(e);
  errorMessage.textContent = path ? raw.replace(` (at ${path})`, "") : raw;
  errorPanel.classList.add("show");
  panes.classList.add("dimmed");
  badge.className = "warn";
  badge.textContent = isParse
    ? "⚠ parse rejected — strictness is the point"
    : "⚠ error";
}

function clearError(): void {
  errorPanel.classList.remove("show");
  panes.classList.remove("dimmed");
}

function run(): void {
  const html = source.value;
  let tree: LayoutNode;
  try {
    tree = parseHTML(html);
  } catch (e) {
    showError(e);
    return;
  }
  let boxes: Map<string, ResolvedBox>;
  try {
    boxes = solveLayout(tree).boxes;
  } catch (e) {
    showError(e);
    return;
  }
  clearError();
  renderBrowser(html);
  const compared = compare(tree, boxes);
  renderSolver(tree, boxes, compared.mismatched);
  setMatchBadge(compared);
}

let debounce: number | undefined;
source.addEventListener("input", () => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(run, 150);
});

for (const btn of document.querySelectorAll<HTMLButtonElement>(
  ".btn[data-preset]",
)) {
  btn.addEventListener("click", () => {
    source.value = PRESETS[btn.dataset.preset!];
    run();
  });
}

source.value = PRESETS.seed;
run();
