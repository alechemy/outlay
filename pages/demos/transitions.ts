import type { LayoutNode, ResolvedBox } from "constraint-layout-algo";
import { solveLayout } from "constraint-layout-algo";
import { colorAt } from "./palette";

const STAGE_W = 660;
const STAGE_H = 420;
const DURATION = 460;

const ITEMS = [
  { w: 96, h: 64 }, { w: 72, h: 92 }, { w: 120, h: 56 }, { w: 84, h: 84 },
  { w: 64, h: 72 }, { w: 108, h: 68 }, { w: 76, h: 100 }, { w: 92, h: 60 },
  { w: 68, h: 88 }, { w: 116, h: 76 },
];

type FlexDirection = "row" | "column";
type FlexWrap = "nowrap" | "wrap";
type JustifyContent =
  | "flex-start" | "flex-end" | "center"
  | "space-between" | "space-around" | "space-evenly";
type AlignItems = "flex-start" | "center" | "flex-end";

interface Config {
  flexDirection: FlexDirection;
  flexWrap: FlexWrap;
  justifyContent: JustifyContent;
  alignItems: AlignItems;
}

const config: Config = {
  flexDirection: "row",
  flexWrap: "wrap",
  justifyContent: "space-between",
  alignItems: "center",
};

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const stage = document.getElementById("stage")!;
const badge = document.getElementById("badge")!;
stage.style.width = STAGE_W + "px";
stage.style.height = STAGE_H + "px";

const boxEls: HTMLElement[] = ITEMS.map((_, i) => {
  const el = document.createElement("div");
  el.className = "anim-box";
  el.style.background = colorAt(i);
  el.textContent = String(i + 1);
  stage.appendChild(el);
  return el;
});

function buildTree(cfg: Config): LayoutNode {
  return {
    id: "root",
    display: "flex",
    width: STAGE_W,
    height: STAGE_H,
    padding: 16,
    gap: 12,
    flexDirection: cfg.flexDirection,
    flexWrap: cfg.flexWrap,
    justifyContent: cfg.justifyContent,
    alignItems: cfg.alignItems,
    alignContent: "center",
    children: ITEMS.map((it, i) => ({
      id: `item-${i}`,
      width: it.w,
      height: it.h,
      flexGrow: 0,
      flexShrink: 0,
    })),
  };
}

function solveFrames(cfg: Config): { frames: Frame[]; ms: number } {
  const t0 = performance.now();
  const { boxes } = solveLayout(buildTree(cfg));
  const ms = performance.now() - t0;
  const root = boxes.get("root")!;
  const frames = ITEMS.map((_, i) => {
    const b = boxes.get(`item-${i}`) as ResolvedBox;
    return {
      x: b.x - root.x,
      y: b.y - root.y,
      w: b.borderBoxWidth,
      h: b.borderBoxHeight,
    };
  });
  return { frames, ms };
}

let current: Frame[] = solveFrames(config).frames;
paint(current);

let rafId = 0;

function paint(frames: Frame[]) {
  frames.forEach((f, i) => {
    const el = boxEls[i];
    el.style.left = f.x + "px";
    el.style.top = f.y + "px";
    el.style.width = f.w + "px";
    el.style.height = f.h + "px";
  });
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function transitionTo(cfg: Config) {
  const { frames: target, ms } = solveFrames(cfg);
  badge.innerHTML =
    `solved in <strong>${ms.toFixed(3)} ms</strong><br />` +
    `${ITEMS.length} boxes · off-DOM`;

  const from = current.map((f) => ({ ...f }));
  const start = performance.now();
  cancelAnimationFrame(rafId);

  function step(now: number) {
    const t = Math.min(1, (now - start) / DURATION);
    const e = easeInOut(t);
    const interp = from.map((f, i) => ({
      x: f.x + (target[i].x - f.x) * e,
      y: f.y + (target[i].y - f.y) * e,
      w: f.w + (target[i].w - f.w) * e,
      h: f.h + (target[i].h - f.h) * e,
    }));
    paint(interp);
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      current = target;
    }
  }
  rafId = requestAnimationFrame(step);
}

const GROUPS: {
  key: keyof Config;
  label: string;
  options: string[];
}[] = [
  { key: "flexDirection", label: "flex-direction", options: ["row", "column"] },
  { key: "flexWrap", label: "flex-wrap", options: ["nowrap", "wrap"] },
  {
    key: "justifyContent",
    label: "justify-content",
    options: [
      "flex-start", "center", "flex-end",
      "space-between", "space-around", "space-evenly",
    ],
  },
  {
    key: "alignItems",
    label: "align-items",
    options: ["flex-start", "center", "flex-end"],
  },
];

function renderControls() {
  const host = document.getElementById("controls")!;
  host.innerHTML = "";
  for (const group of GROUPS) {
    const wrap = document.createElement("div");
    wrap.className = "control-group";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = group.label;
    wrap.appendChild(label);

    const seg = document.createElement("div");
    seg.className = "seg";
    for (const opt of group.options) {
      const btn = document.createElement("button");
      btn.textContent = opt;
      btn.className = config[group.key] === opt ? "active" : "";
      btn.addEventListener("click", () => {
        (config as any)[group.key] = opt;
        renderControls();
        transitionTo(config);
      });
      seg.appendChild(btn);
    }
    wrap.appendChild(seg);
    host.appendChild(wrap);
  }
}

renderControls();
transitionTo(config);
