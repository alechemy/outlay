import type { LayoutNode } from "constraint-layout-algo";
import { solveLayout } from "constraint-layout-algo";
import { colorAt } from "./palette";

const COLS = 4;
const GAP = 16;
const PAD = 18;
const BOARD_W = 720;
const CARD_H = 96;

const LABELS = [
  "Overview", "Revenue", "Traffic", "Signups",
  "Retention", "Latency", "Errors", "Uptime",
  "Sessions", "Queue", "Storage", "Alerts",
];

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

let order = LABELS.map((_, i) => `card-${i}`);

const board = document.getElementById("board")!;
board.style.width = BOARD_W + "px";
const stat = document.getElementById("stat")!;

const cardEls = new Map<string, HTMLElement>();
LABELS.forEach((label, i) => {
  const id = `card-${i}`;
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.id = id;
  el.style.background = colorAt(i);
  el.innerHTML =
    `<span class="idx">${String(i + 1).padStart(2, "0")}</span>` +
    `<span class="name">${label}</span>`;
  board.appendChild(el);
  cardEls.set(id, el);
  el.addEventListener("pointerdown", (e) => startDrag(e, id));
});

function buildTree(ids: string[]): LayoutNode {
  return {
    id: "board",
    display: "grid",
    width: BOARD_W,
    padding: PAD,
    gap: GAP,
    gridTemplateColumns: [{ repeat: COLS, tracks: ["1fr"] }],
    gridAutoRows: CARD_H,
    children: ids.map((id) => ({ id, height: CARD_H })),
  };
}

let lastMs = 0;

function solveSlots(ids: string[]): { slots: Map<string, Slot>; height: number } {
  const t0 = performance.now();
  const { boxes } = solveLayout(buildTree(ids));
  lastMs = performance.now() - t0;
  const root = boxes.get("board")!;
  const slots = new Map<string, Slot>();
  for (const id of ids) {
    const b = boxes.get(id)!;
    slots.set(id, {
      x: b.x - root.x,
      y: b.y - root.y,
      w: b.borderBoxWidth,
      h: b.borderBoxHeight,
    });
  }
  return { slots, height: root.borderBoxHeight };
}

function applySlots(slots: Map<string, Slot>, skip?: string) {
  for (const [id, s] of slots) {
    if (id === skip) continue;
    const el = cardEls.get(id)!;
    el.style.width = s.w + "px";
    el.style.height = s.h + "px";
    el.style.transform = `translate(${s.x}px, ${s.y}px)`;
  }
}

function layoutRest() {
  const { slots, height } = solveSlots(order);
  board.style.height = height + "px";
  applySlots(slots);
  restSlots = slots;
  updateStat(false);
}

let restSlots = new Map<string, Slot>();
let geom = { colW: 0, rowH: CARD_H };

function updateStat(dragging: boolean) {
  const rows = Math.ceil(order.length / COLS);
  stat.innerHTML = dragging
    ? `re-solving on drag · <strong>${lastMs.toFixed(3)} ms</strong>/move`
    : `${order.length} cards · ${COLS}×${rows} grid · solved in <strong>${lastMs.toFixed(3)} ms</strong>`;
}

// --- Drag state ---
interface DragState {
  id: string;
  pointerId: number;
  grabDX: number;
  grabDY: number;
  pendingOrder: string[];
}
let drag: DragState | null = null;

function startDrag(e: PointerEvent, id: string) {
  e.preventDefault();
  const el = cardEls.get(id)!;
  const boardRect = board.getBoundingClientRect();
  const s = restSlots.get(id)!;
  geom = { colW: s.w, rowH: s.h };
  const pointerX = e.clientX - boardRect.left;
  const pointerY = e.clientY - boardRect.top;
  drag = {
    id,
    pointerId: e.pointerId,
    grabDX: pointerX - s.x,
    grabDY: pointerY - s.y,
    pendingOrder: [...order],
  };
  el.classList.add("dragging");
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  try {
    el.setPointerCapture(e.pointerId);
  } catch {}
  updateStat(true);
}

function targetIndex(px: number, py: number, count: number): number {
  const cellW = geom.colW + GAP;
  const cellH = geom.rowH + GAP;
  const col = Math.max(0, Math.min(COLS, Math.round((px - PAD) / cellW)));
  const row = Math.max(0, Math.floor((py - PAD + cellH * 0.5) / cellH));
  return Math.max(0, Math.min(count, row * COLS + col));
}

function onMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const boardRect = board.getBoundingClientRect();
  const px = e.clientX - boardRect.left;
  const py = e.clientY - boardRect.top;

  const others = order.filter((id) => id !== drag!.id);
  const k = targetIndex(px, py, others.length);
  const candidate = [...others];
  candidate.splice(k, 0, drag.id);
  drag.pendingOrder = candidate;

  const { slots } = solveSlots(candidate);
  applySlots(slots, drag.id);

  const el = cardEls.get(drag.id)!;
  el.style.transform = `translate(${px - drag.grabDX}px, ${py - drag.grabDY}px) scale(1.04)`;
  updateStat(true);
}

function onUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const el = cardEls.get(drag.id)!;
  el.removeEventListener("pointermove", onMove);
  el.removeEventListener("pointerup", onUp);
  el.removeEventListener("pointercancel", onUp);
  el.classList.remove("dragging");
  order = drag.pendingOrder;
  drag = null;
  layoutRest();
}

document.getElementById("shuffle")!.addEventListener("click", () => {
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  layoutRest();
});

layoutRest();
