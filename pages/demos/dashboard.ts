import type { LayoutNode, ResolvedBox } from "outlay";
import { solveLayout } from "outlay";
import { gridStyleDeclarations } from "../../tests/grid-css";

interface DNode {
  id: string;
  cls: string;
  layout: Partial<LayoutNode>;
  text?: string;
  bg?: string;
  color?: string;
  children?: DNode[];
}

const NAV = ["Overview", "Traffic", "Revenue", "Cohorts", "Settings"];
const CARDS = [
  { label: "Visitors", value: "24,183", delta: "+12.4%", good: true, accent: "#8a9a5b" },
  { label: "Revenue", value: "$48.2k", delta: "+8.1%", good: true, accent: "#b0864e" },
  { label: "Signups", value: "1,204", delta: "+3.7%", good: true, accent: "#7d93b0" },
  { label: "Churn", value: "2.1%", delta: "-0.4%", good: true, accent: "#a9738f" },
  { label: "Avg latency", value: "82 ms", delta: "-6 ms", good: true, accent: "#6f9e8f" },
  { label: "Errors", value: "0.03%", delta: "+0.01%", good: false, accent: "#b5654d" },
];

function barHeights(c: number): number[] {
  return Array.from({ length: 6 }, (_, i) => 14 + ((c * 13 + i * 17) % 38));
}

function mk(
  id: string,
  cls: string,
  layout: Partial<LayoutNode>,
  extra: Partial<DNode> = {},
  children?: DNode[],
): DNode {
  return { id, cls, layout, children, ...extra };
}

const SIDEBAR_W = 210;
const MAIN_PAD = 20;
const CARD_MIN = 210;
const CARD_GAP = 16;

function columnCount(width: number): number {
  const avail = width - SIDEBAR_W - MAIN_PAD * 2;
  const n = Math.floor((avail + CARD_GAP) / (CARD_MIN + CARD_GAP));
  return Math.max(1, Math.min(CARDS.length, n));
}

function build(width: number): DNode {
  const cols = columnCount(width);
  const header = mk(
    "header",
    "k-header",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: { top: 0, right: 20, bottom: 0, left: 20 },
      gap: 12,
      height: 58,
      border: { top: 0, right: 0, bottom: 1, left: 0 },
    },
    {},
    [
      mk("brand", "", { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }, {}, [
        mk("brand-logo", "k-logo", { width: 26, height: 26 }),
        mk("brand-text", "k-brand-text d-text", { width: 180, height: 20 }, { text: "Constraint Analytics" }),
      ]),
      mk("actions", "", { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }, {}, [
        mk("act-0", "k-pill d-text center", { width: 96, height: 28 }, { text: "Last 7 days" }),
        mk("act-1", "k-pill d-text center", { width: 68, height: 28 }, { text: "Export" }),
      ]),
    ],
  );

  const sidebar = mk(
    "sidebar",
    "k-sidebar",
    {
      width: 210,
      display: "flex",
      flexDirection: "column",
      padding: { top: 16, right: 14, bottom: 16, left: 14 },
      gap: 4,
      border: { top: 0, right: 1, bottom: 0, left: 0 },
    },
    {},
    NAV.map((label, i) =>
      mk(
        `nav-${i}`,
        i === 0 ? "k-navitem-active" : "k-navitem",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: { top: 8, right: 10, bottom: 8, left: 10 },
          height: 36,
        },
        {},
        [
          mk(`nav-${i}-icon`, "k-navicon", { width: 16, height: 16 }),
          mk(`nav-${i}-label`, "k-navlabel d-text", { flexGrow: 1, height: 16 }, { text: label }),
        ],
      ),
    ),
  );

  const cardgrid = mk(
    "cardgrid",
    "",
    {
      display: "grid",
      gridTemplateColumns: [{ repeat: cols, tracks: ["1fr"] }],
      gridAutoRows: 168,
      gap: CARD_GAP,
    },
    {},
    CARDS.map((card, c) =>
      mk(
        `card-${c}`,
        "k-card",
        {
          display: "flex",
          flexDirection: "column",
          padding: 16,
          gap: 8,
          border: 1,
        },
        {},
        [
          mk(
            `card-${c}-head`,
            "",
            { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 16 },
            {},
            [
              mk(`card-${c}-label`, "k-card-label d-text", { flexGrow: 1, height: 14 }, { text: card.label }),
              mk(`card-${c}-dot`, "k-card-dot", { width: 9, height: 9 }, { bg: card.accent }),
            ],
          ),
          mk(`card-${c}-value`, "k-card-value d-text", { height: 30 }, { text: card.value }),
          mk(
            `card-${c}-bars`,
            "",
            { display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 5, flexGrow: 1 },
            {},
            barHeights(c).map((h, i) =>
              mk(`card-${c}-bar-${i}`, "k-bar", { flexGrow: 1, height: h }, {
                bg: i === 5 ? card.accent : card.accent + "70",
              }),
            ),
          ),
          mk(`card-${c}-delta`, "k-card-delta d-text", { height: 14 }, {
            text: card.delta,
            color: card.good ? "var(--ok)" : "var(--bad)",
          }),
        ],
      ),
    ),
  );

  const main = mk(
    "main",
    "",
    { flexGrow: 1, display: "flex", flexDirection: "column", padding: 20, gap: 16 },
    {},
    [
      mk(
        "toolbar",
        "",
        { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 30 },
        {},
        [
          mk("toolbar-title", "k-title d-text", { width: 160, height: 24 }, { text: "Overview" }),
          mk("filters", "", { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }, {}, [
            mk("flt-0", "k-pill d-text center", { width: 44, height: 26 }, { text: "7D" }),
            mk("flt-1", "k-pill d-text center", { width: 52, height: 26 }, { text: "30D" }),
          ]),
        ],
      ),
      cardgrid,
    ],
  );

  const body = mk("body", "", { display: "flex", flexDirection: "row" }, {}, [sidebar, main]);

  return mk("shell", "", { display: "flex", flexDirection: "column", width }, {}, [header, body]);
}

// --- LayoutNode conversion ---
function toLayoutNode(d: DNode): LayoutNode {
  return { id: d.id, ...d.layout, children: d.children?.map(toLayoutNode) ?? [] };
}

function eachNode(d: DNode, fn: (d: DNode) => void) {
  fn(d);
  d.children?.forEach((c) => eachNode(c, fn));
}

// --- CSS serialization ---
function sides(v: number | Partial<Record<"top" | "right" | "bottom" | "left", number>>) {
  if (typeof v === "number") return { top: v, right: v, bottom: v, left: v };
  return { top: 0, right: 0, bottom: 0, left: 0, ...v };
}

function boxModelCss(l: Partial<LayoutNode>): string {
  const s: string[] = [];
  if (l.padding !== undefined) {
    const p = sides(l.padding as any);
    s.push(`padding:${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`);
  }
  if (l.border !== undefined) {
    const b = sides(l.border as any);
    s.push(`border-style:solid`, `border-width:${b.top}px ${b.right}px ${b.bottom}px ${b.left}px`);
  }
  return s.join(";");
}

function cssFor(l: Partial<LayoutNode>): string {
  const s: string[] = [];
  if (l.display) s.push(`display:${l.display}`);
  if (l.flexDirection) s.push(`flex-direction:${l.flexDirection}`);
  if (l.justifyContent) s.push(`justify-content:${l.justifyContent}`);
  if (l.alignItems) s.push(`align-items:${l.alignItems}`);
  if (l.flexGrow !== undefined) s.push(`flex-grow:${l.flexGrow}`);
  if (typeof l.width === "number") s.push(`width:${l.width}px`);
  if (typeof l.height === "number") s.push(`height:${l.height}px`);
  if (l.gap !== undefined) {
    if (typeof l.gap === "number") s.push(`gap:${l.gap}px`);
    else s.push(`row-gap:${l.gap.row}px`, `column-gap:${l.gap.column}px`);
  }
  s.push(boxModelCss(l));
  s.push(...gridStyleDeclarations(l as LayoutNode));
  return s.filter(Boolean).join(";");
}

// --- Render ---
const stage = document.getElementById("stage")!;
const solverRoot = document.getElementById("solver-root")!;
const cssRoot = document.getElementById("css-root")!;
const timingEl = document.getElementById("timing")!;
const matchEl = document.getElementById("match")!;

let mode: "solver" | "css" = "solver";
let tree: DNode = build(0);

function renderSolver(boxes: Map<string, ResolvedBox>) {
  solverRoot.innerHTML = "";
  const rootBox = boxes.get("shell")!;
  solverRoot.style.width = rootBox.borderBoxWidth + "px";
  solverRoot.style.height = rootBox.borderBoxHeight + "px";
  stage.style.height = rootBox.borderBoxHeight + "px";

  eachNode(tree, (d) => {
    const box = boxes.get(d.id);
    if (!box) return;
    const el = document.createElement("div");
    el.className = "d-box " + d.cls;
    el.dataset.id = d.id;
    let css =
      `left:${box.x - rootBox.x}px;top:${box.y - rootBox.y}px;` +
      `width:${box.borderBoxWidth}px;height:${box.borderBoxHeight}px;` +
      boxModelCss(d.layout);
    if (d.bg) css += `;background:${d.bg}`;
    if (d.color) css += `;color:${d.color}`;
    el.style.cssText = css;
    if (d.text) el.textContent = d.text;
    solverRoot.appendChild(el);
  });
}

function renderCss() {
  cssRoot.innerHTML = "";
  cssRoot.style.width = (tree.layout.width as number) + "px";

  function buildEl(d: DNode): HTMLElement {
    const el = document.createElement("div");
    el.className = "d-css-box " + d.cls;
    el.dataset.id = d.id;
    let css = cssFor(d.layout);
    if (d.bg) css += `;background:${d.bg}`;
    if (d.color) css += `;color:${d.color}`;
    el.style.cssText = css;
    if (d.text) el.textContent = d.text;
    d.children?.forEach((c) => el.appendChild(buildEl(c)));
    return el;
  }
  cssRoot.appendChild(buildEl(tree));
}

function compare(boxes: Map<string, ResolvedBox>): { max: number; worst: string } {
  const rootBox = boxes.get("shell")!;
  const cssRect = cssRoot.getBoundingClientRect();
  let max = 0;
  let worst = "";
  eachNode(tree, (d) => {
    const box = boxes.get(d.id);
    const el = cssRoot.querySelector<HTMLElement>(`[data-id="${d.id}"]`);
    if (!box || !el) return;
    const r = el.getBoundingClientRect();
    const deltas = [
      Math.abs(box.x - rootBox.x - (r.left - cssRect.left)),
      Math.abs(box.y - rootBox.y - (r.top - cssRect.top)),
      Math.abs(box.borderBoxWidth - r.width),
      Math.abs(box.borderBoxHeight - r.height),
    ];
    for (const dd of deltas) {
      if (dd > max) {
        max = dd;
        worst = d.id;
      }
    }
  });
  return { max, worst };
}

const codeEl = document.getElementById("mode-code")!;
let lastBoxes: Map<string, ResolvedBox> | null = null;
let lastSolveMs = 0;
let lastMax = 0;
let nodeCount = 0;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function findNode(id: string): DNode | null {
  let found: DNode | null = null;
  eachNode(tree, (d) => {
    if (d.id === id) found = d;
  });
  return found;
}

function updateCodePanel() {
  if (!lastBoxes) return;
  const card = lastBoxes.get("card-0");
  const shell = lastBoxes.get("shell");
  const grid = findNode("cardgrid");
  if (!card || !shell || !grid) return;
  const x = (card.x - shell.x).toFixed(1);
  const y = (card.y - shell.y).toFixed(1);
  const w = card.borderBoxWidth.toFixed(1);
  const h = card.borderBoxHeight.toFixed(1);
  if (mode === "solver") {
    codeEl.innerHTML =
      `<span class="cm">// this pane: the solver's numbers, drawn as absolutely-positioned divs</span>\n` +
      `<span class="kw">const</span> { boxes } = solveLayout(tree);  <span class="cm">// ${nodeCount} nodes in ${lastSolveMs.toFixed(3)} ms — no DOM involved</span>\n\n` +
      `boxes.get("card-0")  <span class="cm">// → { x: ${x}, y: ${y}, width: ${w}, height: ${h} }</span>\n` +
      esc(`<div style="position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px">`) +
      `  <span class="cm">// ← the VISITORS card above</span>`;
  } else {
    codeEl.innerHTML =
      `<span class="cm">// this pane: the same tree serialized to native CSS — the browser lays it out</span>\n` +
      esc(`<div style="${cssFor(grid.layout)}">`) +
      `  <span class="cm">// the card grid</span>\n\n` +
      `<span class="cm">// the badge cross-checks every node against the solver via getBoundingClientRect:</span>\n` +
      `<span class="cm">// max Δ ${lastMax.toFixed(2)}px across ${nodeCount} nodes</span>`;
  }
}

function applyMode() {
  solverRoot.style.visibility = mode === "solver" ? "visible" : "hidden";
  cssRoot.style.visibility = mode === "css" ? "visible" : "hidden";
  for (const btn of document.querySelectorAll<HTMLElement>("#mode button")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  updateCodePanel();
}

function update() {
  const width = stage.clientWidth || 1000;
  tree = build(width);
  const t0 = performance.now();
  const { boxes } = solveLayout(toLayoutNode(tree));
  const ms = performance.now() - t0;

  renderCss();
  renderSolver(boxes);

  nodeCount = 0;
  eachNode(tree, () => nodeCount++);
  timingEl.innerHTML = `${nodeCount} nodes · solved in <strong>${ms.toFixed(3)} ms</strong>`;

  const { max, worst } = compare(boxes);
  lastBoxes = boxes;
  lastSolveMs = ms;
  lastMax = max;
  applyMode();
  if (max <= 0.5) {
    matchEl.className = "match ok";
    matchEl.textContent = `✓ solver matches CSS (max Δ ${max.toFixed(2)}px)`;
  } else {
    matchEl.className = "match bad";
    matchEl.textContent = `✗ differs at ${worst} (max Δ ${max.toFixed(2)}px)`;
  }
}

document.getElementById("mode")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!btn) return;
  mode = btn.dataset.mode as "solver" | "css";
  applyMode();
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(update, 100);
});

update();
