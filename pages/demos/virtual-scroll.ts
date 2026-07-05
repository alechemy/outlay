import type { LayoutNode } from "outlay";
import { solveLayout } from "outlay";
import { makeTextMeasure } from "./pretext-adapter";

const TOTAL = 10000;
const FONT = "15px Arial";
const LINE_HEIGHT = 22;
const OVERSCAN = 4;
const POOL_SIZE = 64;

const WORDS =
  ("the layout solver computes every row height before paint without touching the dom " +
    "off screen arithmetic keeps scrolling smooth even across ten thousand entries " +
    "pretext measures wrapped text through a canvas pass so the numbers match the browser " +
    "variable heights are notoriously hard yet a single solve resolves them all at once " +
    "no estimation no jump correction just exact positions from pure math on the main thread " +
    "constraint driven boxes flow into a column and the virtual window renders only what is visible")
    .split(" ");

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePoolText(rand: () => number): string {
  const sentences = 1 + Math.floor(rand() * 4);
  const out: string[] = [];
  for (let s = 0; s < sentences; s++) {
    const len = 5 + Math.floor(rand() * 16);
    const words: string[] = [];
    for (let w = 0; w < len; w++) {
      words.push(WORDS[Math.floor(rand() * WORDS.length)]);
    }
    let sentence = words.join(" ");
    sentence = sentence[0].toUpperCase() + sentence.slice(1) + ".";
    out.push(sentence);
  }
  return out.join(" ");
}

const rand = mulberry32(0x5eed);
const POOL = Array.from({ length: POOL_SIZE }, () => makePoolText(rand));

// Rows share 64 paragraphs, so measuring each (text, width) pair once collapses
// ~30k measureContent calls per solve into 64 — the prepare-once/layout-cheap
// split a production adapter would use.
function memoizeMeasure(
  measure: (w: number) => { width: number; height: number },
): (w: number) => { width: number; height: number } {
  const cache = new Map<number, { width: number; height: number }>();
  return (w) => {
    let r = cache.get(w);
    if (!r) {
      r = measure(w);
      cache.set(w, r);
    }
    return r;
  };
}

const poolMeasurers = POOL.map((t) =>
  memoizeMeasure(makeTextMeasure(t, FONT, LINE_HEIGHT)),
);

function poolIndex(i: number): number {
  return (i * 31 + 7) % POOL_SIZE;
}

function buildTree(width: number): LayoutNode {
  return {
    id: "list",
    display: "flex",
    flexDirection: "column",
    width,
    children: Array.from({ length: TOTAL }, (_, i) => ({
      id: `row-${i}`,
      display: "block",
      padding: { top: 14, right: 22, bottom: 14, left: 22 },
      border: { bottom: 1 },
      measureContent: poolMeasurers[poolIndex(i)],
    })),
  };
}

interface RowGeom {
  y: number;
  h: number;
}

const scroller = document.getElementById("scroller")!;
const canvas = document.getElementById("canvas")!;
const statsEl = document.getElementById("stats")!;

let rows: RowGeom[] = [];
let totalHeight = 0;
let listWidth = 0;
let solveMs = 0;

function solveAll() {
  listWidth = scroller.clientWidth || 700;
  const t0 = performance.now();
  const { boxes } = solveLayout(buildTree(listWidth));
  solveMs = performance.now() - t0;
  const root = boxes.get("list")!;
  totalHeight = root.borderBoxHeight;
  rows = Array.from({ length: TOTAL }, (_, i) => {
    const b = boxes.get(`row-${i}`)!;
    return { y: b.y - root.y, h: b.borderBoxHeight };
  });
  canvas.style.height = totalHeight + "px";
}

// smallest index whose bottom edge is below `top`
function firstVisible(top: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].y + rows[mid].h > top) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}

const mounted = new Map<number, HTMLElement>();
let lastRange: [number, number] = [-1, -1];

function renderRow(i: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "v-row";
  const g = rows[i];
  el.style.top = g.y + "px";
  el.style.height = g.h + "px";
  el.innerHTML =
    `<span class="v-idx">#${i + 1}</span>` +
    `<div class="v-body"></div>`;
  el.querySelector<HTMLElement>(".v-body")!.textContent = POOL[poolIndex(i)];
  return el;
}

function draw() {
  const top = scroller.scrollTop;
  const bottom = top + scroller.clientHeight;
  let a = firstVisible(top);
  let b = a;
  while (b < rows.length && rows[b].y < bottom) b++;
  a = Math.max(0, a - OVERSCAN);
  b = Math.min(rows.length, b + OVERSCAN);

  if (a === lastRange[0] && b === lastRange[1]) return;
  lastRange = [a, b];

  for (const [i, el] of mounted) {
    if (i < a || i >= b) {
      el.remove();
      mounted.delete(i);
    }
  }
  for (let i = a; i < b; i++) {
    if (!mounted.has(i)) {
      const el = renderRow(i);
      canvas.appendChild(el);
      mounted.set(i, el);
    }
  }
  updateStats();
}

function updateStats() {
  statsEl.innerHTML =
    `<div class="stat">total rows<b>${TOTAL.toLocaleString()}</b></div>` +
    `<div class="stat">DOM nodes<b>${mounted.size}</b></div>` +
    `<div class="stat">content height<b>${Math.round(totalHeight).toLocaleString()} px</b></div>` +
    `<div class="stat">outlay solve, all rows<b>${solveMs.toFixed(1)} ms</b></div>`;
}

document.getElementById("btn-compare")!.addEventListener("click", () => {
  const out = document.getElementById("compare-out")!;

  const t0 = performance.now();
  const { boxes } = solveLayout(buildTree(listWidth));
  const solverNow = performance.now() - t0;
  void boxes;

  const t1 = performance.now();
  const holder = document.createElement("div");
  holder.style.cssText = `position:absolute; left:-99999px; top:0; width:${listWidth}px; visibility:hidden;`;
  for (let i = 0; i < TOTAL; i++) {
    const row = document.createElement("div");
    row.style.cssText = "padding:14px 22px; border-bottom:1px solid transparent;";
    const body = document.createElement("div");
    body.style.cssText = "font:15px/22px Arial,sans-serif; overflow-wrap:anywhere; white-space:normal;";
    body.textContent = POOL[poolIndex(i)];
    row.appendChild(body);
    holder.appendChild(row);
  }
  document.body.appendChild(holder);
  let sink = 0;
  for (const el of holder.children) {
    sink += (el as HTMLElement).getBoundingClientRect().height;
  }
  const domMs = performance.now() - t1;
  holder.remove();
  void sink;

  const ratio = domMs / solverNow;
  out.innerHTML =
    `outlay: ${(TOTAL + 1).toLocaleString()} boxes in <strong>${solverNow.toFixed(1)} ms</strong> · ` +
    `DOM: ${TOTAL.toLocaleString()} rows mounted + measured in <strong>${domMs.toFixed(1)} ms</strong>` +
    (ratio >= 1.05 ? ` · <strong>${ratio.toFixed(1)}× faster</strong>` : "");
});

let ticking = false;
scroller.addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    draw();
  });
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (scroller.clientWidth === listWidth) return;
    for (const [, el] of mounted) el.remove();
    mounted.clear();
    lastRange = [-1, -1];
    solveAll();
    draw();
  }, 150);
});

solveAll();
draw();
