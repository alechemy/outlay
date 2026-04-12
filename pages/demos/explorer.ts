import type { LayoutNode, ResolvedBox } from "constraint-layout-algo";
import { solveLayout } from "constraint-layout-algo";

// --- Color palette for boxes ---
const COLORS = [
  "#e8d5c4", "#c4d4e0", "#d4e0c4", "#e0d4c4", "#c4d8d4",
  "#dcc4e0", "#e0c4c4", "#c4c8e0", "#d8e0c4", "#e0dcc4",
  "#c4e0d8", "#e0c4d8", "#d0c4e0", "#c4e0c8", "#e0ccc4",
  "#c4dce0",
];

function colorForDepth(depth: number): string {
  return COLORS[depth % COLORS.length];
}

// --- State ---
interface TreeNode {
  id: string;
  props: {
    width: number | "auto";
    height: number | "auto";
    flexDirection: "row" | "column";
    justifyContent: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly";
    alignItems: "flex-start" | "flex-end" | "center" | "stretch";
    flexWrap: "nowrap" | "wrap";
    gap: number;
    flexGrow: number;
    flexShrink: number;
    padding: number;
  };
  children: TreeNode[];
  collapsed: boolean;
}

let nextId = 1;
function makeId(): string {
  return `node-${nextId++}`;
}

function createNode(overrides?: Partial<TreeNode["props"]>): TreeNode {
  return {
    id: makeId(),
    props: {
      width: "auto",
      height: "auto",
      flexDirection: "row",
      justifyContent: "flex-start",
      alignItems: "stretch",
      flexWrap: "nowrap",
      gap: 0,
      flexGrow: 0,
      flexShrink: 1,
      padding: 0,
      ...overrides,
    },
    children: [],
    collapsed: false,
  };
}

// Build default tree
const root: TreeNode = {
  id: makeId(),
  props: {
    width: 500,
    height: 400,
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "stretch",
    flexWrap: "nowrap",
    gap: 8,
    flexGrow: 0,
    flexShrink: 1,
    padding: 12,
  },
  children: [
    createNode({ width: 80, height: "auto", flexGrow: 1 }),
    createNode({ width: 80, height: "auto", flexGrow: 2 }),
    createNode({ width: 80, height: "auto", flexGrow: 1 }),
  ],
  collapsed: false,
};

let selectedId: string | null = root.id;
let lastResult: Map<string, ResolvedBox> = new Map();

// --- Tree helpers ---
function findNode(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

function findParent(node: TreeNode, id: string): TreeNode | null {
  for (const c of node.children) {
    if (c.id === id) return node;
    const found = findParent(c, id);
    if (found) return found;
  }
  return null;
}

function nodeDepth(node: TreeNode, id: string, depth = 0): number {
  if (node.id === id) return depth;
  for (const c of node.children) {
    const d = nodeDepth(c, id, depth + 1);
    if (d >= 0) return d;
  }
  return -1;
}

function removeNode(parent: TreeNode, id: string): boolean {
  const idx = parent.children.findIndex((c) => c.id === id);
  if (idx >= 0) {
    parent.children.splice(idx, 1);
    return true;
  }
  for (const c of parent.children) {
    if (removeNode(c, id)) return true;
  }
  return false;
}

// --- Convert tree to LayoutNode ---
function toLayoutNode(node: TreeNode): LayoutNode {
  const ln: LayoutNode = {
    id: node.id,
    display: "flex",
    flexDirection: node.props.flexDirection,
    justifyContent: node.props.justifyContent,
    alignItems: node.props.alignItems,
    flexWrap: node.props.flexWrap,
    gap: node.props.gap,
    flexGrow: node.props.flexGrow,
    flexShrink: node.props.flexShrink,
    padding: node.props.padding,
    children: node.children.map(toLayoutNode),
  };
  if (node.props.width !== "auto") ln.width = node.props.width;
  if (node.props.height !== "auto") ln.height = node.props.height;
  return ln;
}

// --- Solve and render ---
function solve(): Map<string, ResolvedBox> {
  const layoutTree = toLayoutNode(root);
  const t0 = performance.now();
  const result = solveLayout(layoutTree);
  const dt = performance.now() - t0;
  document.getElementById("timing")!.textContent = `${dt.toFixed(2)}ms`;
  lastResult = result.boxes;
  return result.boxes;
}

function renderOutput(boxes: Map<string, ResolvedBox>) {
  const output = document.getElementById("output")!;
  output.innerHTML = "";

  const rootBox = boxes.get(root.id);
  if (!rootBox) return;

  output.style.width = rootBox.borderBoxWidth + "px";
  output.style.height = rootBox.borderBoxHeight + "px";

  function renderBox(node: TreeNode, depth: number) {
    const box = boxes.get(node.id);
    if (!box) return;

    const el = document.createElement("div");
    el.className = "layout-box" + (node.id === selectedId ? " highlighted" : "");
    el.dataset.id = node.id;
    el.style.left = box.x - box.padding.left - box.border.left + "px";
    el.style.top = box.y - box.padding.top - box.border.top + "px";
    el.style.width = box.borderBoxWidth + "px";
    el.style.height = box.borderBoxHeight + "px";
    el.style.background = colorForDepth(depth);

    const label = document.createElement("span");
    label.className = "layout-box-label";
    label.textContent = node.id;
    el.appendChild(label);

    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (box.borderBoxWidth > 50 && box.borderBoxHeight > 24) {
      const dims = document.createElement("span");
      dims.className = "layout-box-dims";
      dims.textContent = `${w}\u00d7${h}`;
      el.appendChild(dims);
    }

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedId = node.id;
      update();
    });

    output.appendChild(el);

    for (const child of node.children) {
      renderBox(child, depth + 1);
    }
  }

  renderBox(root, 0);
}

// --- Tree panel ---
function renderTree() {
  const container = document.getElementById("tree")!;
  container.innerHTML = "";

  function renderNodeInto(node: TreeNode, depth: number, parent: HTMLElement) {
    const div = document.createElement("div");
    div.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-node-row" + (node.id === selectedId ? " selected" : "");
    row.style.paddingLeft = 12 + depth * 16 + "px";

    const toggle = document.createElement("span");
    toggle.className = "tree-node-toggle";
    if (node.children.length > 0) {
      toggle.textContent = node.collapsed ? "\u25b6" : "\u25bc";
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        node.collapsed = !node.collapsed;
        renderTree();
      });
    }
    row.appendChild(toggle);

    const label = document.createElement("span");
    label.className = "tree-node-label";
    const dir = node.props.flexDirection === "column" ? "col" : "row";
    const sizeStr =
      (node.props.width === "auto" ? "auto" : node.props.width) +
      "\u00d7" +
      (node.props.height === "auto" ? "auto" : node.props.height);
    label.textContent = `${node.id} (${dir}, ${sizeStr})`;
    row.appendChild(label);

    row.addEventListener("click", () => {
      selectedId = node.id;
      update();
    });

    div.appendChild(row);

    if (!node.collapsed && node.children.length > 0) {
      const childrenDiv = document.createElement("div");
      childrenDiv.className = "tree-node-children";
      for (const child of node.children) {
        renderNodeInto(child, depth + 1, childrenDiv);
      }
      div.appendChild(childrenDiv);
    }

    parent.appendChild(div);
  }

  renderNodeInto(root, 0, container);
}

// --- Properties panel ---
function renderProps() {
  const panel = document.getElementById("props")!;
  panel.innerHTML = "";

  if (!selectedId) {
    panel.innerHTML = '<span style="color: var(--muted); padding: 8px;">Select a node</span>';
    return;
  }

  const node = findNode(root, selectedId);
  if (!node) return;

  const h3 = document.createElement("h3");
  h3.textContent = `Properties: ${node.id}`;
  panel.appendChild(h3);

  const isRoot = node.id === root.id;

  // Size controls
  addSizeRow(panel, "width", node);
  addSizeRow(panel, "height", node);

  // Flex container controls
  addSelectRow(panel, "flexDirection", node, ["row", "column", "row-reverse", "column-reverse"]);
  addSelectRow(panel, "justifyContent", node, [
    "flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly",
  ]);
  addSelectRow(panel, "alignItems", node, ["stretch", "flex-start", "flex-end", "center"]);
  addSelectRow(panel, "flexWrap", node, ["nowrap", "wrap"]);
  addSliderRow(panel, "gap", node, 0, 40, 1);
  addSliderRow(panel, "padding", node, 0, 40, 1);

  // Flex item controls (not for root)
  if (!isRoot) {
    addSliderRow(panel, "flexGrow", node, 0, 10, 1);
    addSliderRow(panel, "flexShrink", node, 0, 10, 1);
  }

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "node-actions";

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-accent";
  addBtn.textContent = "+ Add Child";
  addBtn.addEventListener("click", () => {
    node.children.push(createNode({ width: 60, height: 40 }));
    update();
  });
  actions.appendChild(addBtn);

  if (!isRoot) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger";
    delBtn.textContent = "Remove";
    delBtn.addEventListener("click", () => {
      const parent = findParent(root, node.id);
      if (parent) {
        removeNode(parent, node.id);
        selectedId = parent.id;
        update();
      }
    });
    actions.appendChild(delBtn);
  }

  panel.appendChild(actions);
}

function addSliderRow(
  panel: HTMLElement,
  prop: keyof TreeNode["props"],
  node: TreeNode,
  min: number,
  max: number,
  step: number,
) {
  const row = document.createElement("div");
  row.className = "prop-row";

  const label = document.createElement("label");
  label.textContent = prop;
  row.appendChild(label);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(node.props[prop]);

  const valSpan = document.createElement("span");
  valSpan.className = "value";
  valSpan.textContent = String(node.props[prop]);

  input.addEventListener("input", () => {
    (node.props as any)[prop] = Number(input.value);
    valSpan.textContent = input.value;
    solveAndRender();
  });

  row.appendChild(input);
  row.appendChild(valSpan);
  panel.appendChild(row);
}

function addSelectRow(
  panel: HTMLElement,
  prop: keyof TreeNode["props"],
  node: TreeNode,
  options: string[],
) {
  const row = document.createElement("div");
  row.className = "prop-row";

  const label = document.createElement("label");
  label.textContent = prop;
  row.appendChild(label);

  const select = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (node.props[prop] === opt) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    (node.props as any)[prop] = select.value;
    solveAndRender();
  });

  row.appendChild(select);
  panel.appendChild(row);
}

function addSizeRow(panel: HTMLElement, prop: "width" | "height", node: TreeNode) {
  const row = document.createElement("div");
  row.className = "prop-row";

  const label = document.createElement("label");
  label.textContent = prop;
  row.appendChild(label);

  const isAuto = node.props[prop] === "auto";

  const select = document.createElement("select");
  const autoOpt = document.createElement("option");
  autoOpt.value = "auto";
  autoOpt.textContent = "auto";
  if (isAuto) autoOpt.selected = true;
  select.appendChild(autoOpt);

  const fixedOpt = document.createElement("option");
  fixedOpt.value = "fixed";
  fixedOpt.textContent = "fixed";
  if (!isAuto) fixedOpt.selected = true;
  select.appendChild(fixedOpt);
  select.style.width = "60px";
  select.style.flex = "none";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "20";
  slider.max = prop === "width" ? "800" : "600";
  slider.step = "1";
  slider.value = isAuto ? "100" : String(node.props[prop]);
  slider.disabled = isAuto;
  slider.style.flex = "1";

  const valSpan = document.createElement("span");
  valSpan.className = "value";
  valSpan.textContent = isAuto ? "auto" : String(node.props[prop]);

  select.addEventListener("change", () => {
    if (select.value === "auto") {
      node.props[prop] = "auto";
      slider.disabled = true;
      valSpan.textContent = "auto";
    } else {
      node.props[prop] = Number(slider.value);
      slider.disabled = false;
      valSpan.textContent = slider.value;
    }
    solveAndRender();
  });

  slider.addEventListener("input", () => {
    node.props[prop] = Number(slider.value);
    valSpan.textContent = slider.value;
    solveAndRender();
  });

  row.appendChild(label);
  row.appendChild(select);
  row.appendChild(slider);
  row.appendChild(valSpan);
  panel.appendChild(row);
}

// --- Detail panel ---
function renderDetail() {
  const panel = document.getElementById("detail")!;
  if (!selectedId) {
    panel.innerHTML = '<span style="color: var(--muted)">Click a node to see its resolved box values.</span>';
    return;
  }

  const box = lastResult.get(selectedId);
  if (!box) {
    panel.innerHTML = '<span style="color: var(--muted)">No resolved box for selection.</span>';
    return;
  }

  const title = document.createElement("div");
  title.className = "detail-title";
  title.textContent = `ResolvedBox: ${box.id}`;

  const grid = document.createElement("div");
  grid.className = "detail-grid";

  const fields: [string, string][] = [
    ["x", box.x.toFixed(1)],
    ["y", box.y.toFixed(1)],
    ["width", box.width.toFixed(1)],
    ["height", box.height.toFixed(1)],
    ["borderBoxW", box.borderBoxWidth.toFixed(1)],
    ["borderBoxH", box.borderBoxHeight.toFixed(1)],
    ["padding", `${box.padding.top} ${box.padding.right} ${box.padding.bottom} ${box.padding.left}`],
    ["margin", `${box.margin.top} ${box.margin.right} ${box.margin.bottom} ${box.margin.left}`],
  ];

  for (const [key, val] of fields) {
    const s = document.createElement("span");
    s.innerHTML = `<span class="detail-key">${key}:</span> <span class="detail-val">${val}</span>`;
    grid.appendChild(s);
  }

  panel.innerHTML = "";
  panel.appendChild(title);
  panel.appendChild(grid);
}

// --- Solve without re-rendering tree/props (for slider dragging) ---
function solveAndRender() {
  const boxes = solve();
  renderOutput(boxes);
  renderDetail();
}

// --- Full update ---
function update() {
  const boxes = solve();
  renderTree();
  renderProps();
  renderOutput(boxes);
  renderDetail();
}

// --- Export ---
document.getElementById("btn-export")!.addEventListener("click", () => {
  const json = JSON.stringify(toLayoutNode(root), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "layout-tree.json";
  a.click();
  URL.revokeObjectURL(url);
});

// --- Add child to root from header button ---
document.getElementById("btn-add-root-child")!.addEventListener("click", () => {
  const target = selectedId ? findNode(root, selectedId) : root;
  if (target) {
    target.children.push(createNode({ width: 60, height: 40 }));
    update();
  }
});

// --- Init ---
update();
