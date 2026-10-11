import {
  FrameScheduler,
  geodesicArc,
  readableLabel,
  LabelGrid,
  leafLabelAngle,
  containsRotatedBox,
} from "./render-utils";
import "./style.css";
import {
  parse,
  examples,
  repositorySources,
  layout,
  siblingStep,
  labelScale as layoutLabelScale,
  leafTextScale,
  label,
  translate,
  readingRotation,
  angleDelta,
  geodesic,
  distance,
  origin,
  type Point,
  type SyntaxNode,
} from "./core";

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
$("#app").innerHTML = `
<main class="observatory">
  <div class="canvas-wrap"><canvas id="space" tabindex="0" aria-label="双曲语法树。向上访问父节点，向下访问第一个子节点，左右按表达式顺序切换兄弟，F 切换专注模式。"></canvas><div id="hover-ring" hidden></div><div id="tooltip" role="tooltip" tabindex="0" hidden></div></div>
  <header class="hud topbar">
    <div class="brand"><span class="brand-icon">⌘</span><div>SYNTAX ATLAS<small>HYPERBOLIC CODE OBSERVATORY</small></div><span class="live-dot"></span></div>
    <div class="divider"></div><select id="example" aria-label="示例程序"></select>
    <nav><button id="toggle-source" aria-expanded="false" aria-controls="source-panel">⌜ 源码</button><button id="toggle-detail" aria-expanded="false" aria-controls="detail-panel">◎ 节点</button><button id="reset" title="Home 回到根节点">⌂ 根节点</button></nav>
  </header>
  <div class="hud pathbar"><span class="eyebrow">PATH /</span><div id="breadcrumb" aria-label="节点路径"></div></div>
  <aside id="source-panel" class="hud source-panel" hidden>
    <div class="panel-heading"><span class="eyebrow">SOURCE BUFFER</span><button id="close-source" aria-label="关闭源码浮层">×</button></div>
    <div id="provenance"></div><div class="source-toolbar"><span id="source-caption">CIRRU / CALCIT</span><button id="edit">编辑 ↗</button></div>
    <div id="source" class="source-code" aria-label="源代码，点击行定位表达式"></div>
    <div id="editor" hidden><textarea id="input" spellcheck="false" aria-label="Cirru 风格源代码"></textarea><p class="editor-hint">Cirru 语法 · 缩进 / () / $ / ,</p><div class="editor-actions"><button id="apply">应用代码</button><button id="cancel">取消</button></div><p id="error" role="alert"></p></div>
  </aside>
  <aside id="detail-panel" class="hud detail-panel" hidden>
    <div class="panel-heading"><span class="eyebrow">NODE INSPECTOR</span><button id="close-detail" aria-label="关闭节点浮层">×</button></div>
    <div class="focus-heading"><span id="kind" class="tag"></span><span id="node-id"></span></div><h2 id="node-title"></h2><p id="node-description"></p>
    <div class="metrics"><div><strong id="depth"></strong><span>嵌套深度</span></div><div><strong id="children-count"></strong><span>子节点</span></div></div>
    <div class="section-label">CHILDREN / 语法顺序</div><div id="children"></div>
  </aside>
  <div class="hud telemetry"><span class="live-dot"></span><strong id="total"></strong><span id="visible-count"></span><span id="travel"></span></div>
  <div class="hud controls"><label>视野 <input id="zoom" aria-label="视野缩放" type="range" min="0.6" max="1.8" step="0.05" value="1.25"><output id="zoom-value">1.25×</output></label><span class="control-divider"></span><label>聚拢 <input id="gather" aria-label="整体距离" type="range" min="0.15" max="1" step="0.05" value="0.4"><output id="gather-value">0.40</output></label></div>
  <div class="key-guide"><span>↑ 父节点 · ↓ 首个子节点</span><span>← → 同级顺序</span><span>滚轮 缩放</span><span>F 专注</span><span>青色细线 父→首个子节点 · 紫色宽带 同级顺序 · ○ 表达式</span></div>
  <button id="focus-mode" class="hud focus-toggle" aria-pressed="false" title="F 切换专注模式">⛶ 专注模式 <kbd>F</kbd></button>
  <div class="focus-coordinate" id="focus-coordinate">module</div>
  <div id="announcement" class="sr-only" aria-live="polite"></div>
</main>`;

const canvas = $<HTMLCanvasElement>("#space");
const ctx = canvas.getContext("2d")!;
const select = $<HTMLSelectElement>("#example");
Object.keys(examples).forEach((name) => select.add(new Option(name, name)));
let source = examples["Soluble · 应用全景"];
// Layout spacing is fixed; how spread out the view looks is controlled by `gather`.
const spacing = 0.5;
let zoom = 1.25,
  // Scales every hyperbolic distance from the focus: < 1 draws the whole plane toward it.
  gather = 0.4,
  focusMode = false;
let tree = parse(source),
  selected = tree.root;
layout(tree.root, spacing);
let camera: Point = { ...origin };
let rotation = readingRotation(selected);
let animation:
  | {
      from: Point;
      to: Point;
      fromRotation: number;
      toRotation: number;
      start: number;
      duration: number;
    }
  | undefined;
let width = 0,
  height = 0,
  radius = 0;
let hitboxes: {
  node: SyntaxNode;
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}[] = [];
let hovered: SyntaxNode | undefined;
let renderCount = 0;
const scheduler = new FrameScheduler(
  draw,
  (callback) => requestAnimationFrame(callback),
  (id) => cancelAnimationFrame(id),
);
const background = document.createElement("canvas");
const backgroundCtx = background.getContext("2d")!;
let backgroundKey = "";
let dpr = 1;
let ancestors = new Set<number>();
// Reading distance from the focus for every node, along the code's own links: parent →
// first child costs 1, each step to the next sibling costs `siblingStep`. Long sibling
// lists recede gradually instead of all counting as one hop away. Far nodes fade out, so
// where far branches brush against each other matters little.
function hopsFrom(node: SyntaxNode) {
  // Costs in tenths are small integers, so a bucket queue is an exact Dijkstra.
  const parentCost = 10,
    siblingCost = Math.round(siblingStep * 10);
  const tenths = new Array<number>(tree.nodes.length).fill(Infinity);
  const buckets: SyntaxNode[][] = [[node]];
  tenths[node.id] = 0;
  for (let step = 0; step < buckets.length; step++)
    for (const current of buckets[step] ?? []) {
      if (tenths[current.id] !== step) continue;
      const siblings = current.parent?.children ?? [];
      const index = siblings.indexOf(current);
      const links: [SyntaxNode | undefined, number][] = [
        [current.children[0], parentCost],
        [index === 0 ? current.parent : undefined, parentCost],
        [siblings[index + 1], siblingCost],
        [index > 0 ? siblings[index - 1] : undefined, siblingCost],
      ];
      for (const [next, cost] of links) {
        if (!next || tenths[next.id] <= step + cost) continue;
        tenths[next.id] = step + cost;
        (buckets[step + cost] ??= []).push(next);
      }
    }
  return tenths.map((t) => t / 10);
}
// Cached on focus changes, never recomputed in animation frames.
let hops = hopsFrom(selected);
// Labels this close (in node distance) win label-placement priority and are always drawn.
const nearby = (id: number) => hops[id] <= 4;
// Opacity by reading distance from the focus: full within 5, then fading one level per
// unit down to 0.08 (92% transparent). Links, dots and labels all follow the same rule.
const fadeLevels = [1, 0.7, 0.45, 0.28, 0.17, 0.11, 0.08];
const fadeLevel = (id: number) =>
  Math.min(fadeLevels.length - 1, Math.max(0, Math.ceil(hops[id] - 5)));
let labelNames = tree.nodes.map(label);
const shortLeaf = (text: string) => {
  const chars = Array.from(text.replace(/\s/g, " "));
  return chars.length > 16 ? chars.slice(0, 15).join("") + "…" : chars.join("");
};
let leafLabels = tree.nodes.map((node) => shortLeaf(node.text));
// Topology is cached per program; camera frames only project the endpoints.
const siblingPairs = () =>
  tree.nodes.flatMap((parent) =>
    parent.children
      .slice(1)
      .map((child, i) => [parent.children[i].id, child.id] as const),
  );
let siblingEdges = siblingPairs();
const indexSiblings = () =>
  tree.nodes.map((node) =>
    node.parent ? node.parent.children.indexOf(node) + 1 : 0,
  );
let siblingOrder = indexSiblings();
const isContainer = (node: SyntaxNode) =>
  node.kind === "root" || node.kind === "expression";
function fullContent(node: SyntaxNode): string {
  if (!isContainer(node)) return node.text;
  const write = (item: SyntaxNode): string =>
    isContainer(item)
      ? "(" + item.children.map(write).join(" ") + ")"
      : /[\s()"$]/.test(item.text)
        ? JSON.stringify(item.text)
        : item.text;
  return node.kind === "root"
    ? node.children.map(write).join("\n\n")
    : write(node);
}
const textWidths = new Map<string, number>();
const tooltip = $("#tooltip");
const hoverRing = $("#hover-ring");
const visibleCount = $("#visible-count");
const travel = $("#travel");
let lastHudTime = 0;
function changedText(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text;
}
function measure(text: string, font: number, bold: boolean) {
  const key = `${bold}:${font}:${text}`;
  let width = textWidths.get(key);
  if (width === undefined) {
    width = ctx.measureText(text).width;
    if (textWidths.size >= 12000) textWidths.clear();
    textWidths.set(key, width);
  }
  return width;
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const colors = {
  root: "#a8e6ce",
  expression: "#a8e6ce",
  symbol: "#a7bddc",
  literal: "#dbbb83",
};
const kindNames = {
  root: "模块根节点",
  expression: "表达式",
  symbol: "符号",
  literal: "字面量",
};
function pathTo(node: SyntaxNode) {
  const path = [node];
  while (node.parent) {
    node = node.parent;
    path.unshift(node);
  }
  return path;
}
function button(text: string, action: () => void, className = "") {
  const b = document.createElement("button");
  b.textContent = text;
  b.className = className;
  b.onclick = action;
  return b;
}
function syncPanels() {
  $(".detail-panel").scrollTop = 0;
  $("#kind").textContent = kindNames[selected.kind];
  $("#node-id").textContent = `#${String(selected.id).padStart(3, "0")}`;
  $("#node-title").textContent = label(selected);
  $("#node-description").textContent =
    selected.kind === "root"
      ? "整个程序的入口。选择一个分支，开始阅读。"
      : `第 ${selected.line} 行 · ${selected.children.length ? "按从左到右的顺序展开子节点。" : "一个不可再分的语法单元。"}`;
  $("#depth").textContent = String(selected.depth).padStart(2, "0");
  $("#children-count").textContent = String(selected.children.length).padStart(
    2,
    "0",
  );
  $("#children").replaceChildren(
    ...selected.children.map((n, i) =>
      button(
        `${String(i + 1).padStart(2, "0")}   ${label(n)}   ↗`,
        () => focus(n),
        `child ${n.kind}`,
      ),
    ),
  );
  if (!selected.children.length)
    $("#children").textContent = "已经到达叶节点。↑ 返回上一级";
  $("#breadcrumb").replaceChildren(
    ...pathTo(selected).map((n) => button(label(n), () => focus(n))),
  );
  document
    .querySelectorAll<HTMLButtonElement>(".source-line")
    .forEach((line) => {
      const active = Number(line.dataset.line) === selected.line;
      line.classList.toggle("active", active);
      if (active) {
        const container = $("#source"),
          top = line.offsetTop;
        if (top < container.scrollTop) container.scrollTop = top;
        else if (
          top + line.offsetHeight >
          container.scrollTop + container.clientHeight
        )
          container.scrollTop =
            top + line.offsetHeight - container.clientHeight;
      }
    });
  $("#total").textContent = `${tree.nodes.length.toLocaleString()} NODES`;
  $("#focus-coordinate").textContent =
    `${label(selected)} / ${String(selected.id).padStart(4, "0")}`;
  $("#announcement").textContent =
    `${kindNames[selected.kind]} ${label(selected)}，${selected.children.length} 个子节点`;
}
function renderSource() {
  const repository = repositorySources.find(
    (example) => example.code === source,
  );
  $("#provenance").textContent = repository
    ? `${repository.source} · ${repository.excerpts.map((e) => `${e.name} : L${e.line}–${e.endLine}`).join(" / ")}`
    : "自定义 / Cirru 源码";
  $("#source-caption").textContent =
    `${source.split("\n").length} LINES · ${repository ? "REPOSITORY EXCERPT" : "CIRRU"}`;
  $("#source").replaceChildren(
    ...source.split("\n").map((line, i) => {
      const n =
        tree.nodes.find((n) => n.line === i + 1 && n.kind === "expression") ??
        tree.nodes.find((n) => n.line === i + 1);
      const b = button(
        "",
        () => {
          if (n) focus(n);
        },
        "source-line",
      );
      b.dataset.line = String(i + 1);
      b.disabled = !n;
      const number = document.createElement("span");
      number.className = "line-number";
      number.textContent = String(i + 1).padStart(2, "0");
      const code = document.createElement("code");
      code.textContent = line || " ";
      if (line.trim().startsWith(";")) code.className = "comment";
      b.append(number, code);
      return b;
    }),
  );
}
function sampleCamera(now: number) {
  if (!animation) return;
  const t = Math.min(1, (now - animation.start) / animation.duration);
  const eased = t * t * (3 - 2 * t);
  camera = geodesic(animation.from, animation.to, eased);
  rotation =
    animation.fromRotation +
    (animation.toRotation - animation.fromRotation) * eased;
  if (t === 1) animation = undefined;
}
function focus(node: SyntaxNode) {
  if (
    node === selected &&
    (animation || distance(camera, node.position) < 1e-6)
  )
    return;
  sampleCamera(performance.now());
  selected = node;
  hops = hopsFrom(node);
  ancestors = new Set(pathTo(node).map((n) => n.id));
  const d = distance(camera, node.position);
  const targetRotation =
    rotation + angleDelta(rotation, readingRotation(node, rotation));
  if (
    reducedMotion.matches ||
    (d < 1e-6 && Math.abs(targetRotation - rotation) < 1e-6)
  ) {
    rotation = targetRotation;
    camera = { ...node.position };
    animation = undefined;
  } else
    animation = {
      from: { ...camera },
      to: node.position,
      fromRotation: rotation,
      toRotation: targetRotation,
      start: performance.now(),
      duration: Math.min(1200, 480 + d * 80),
    };
  hovered = undefined;
  tooltip.hidden = true;
  hoverRing.hidden = true;
  syncPanels();
  canvas.focus({ preventScroll: true });
  requestDraw();
}
function requestDraw() {
  hovered = undefined;
  hoverRing.hidden = true;
  tooltip.hidden = true;
  scheduler.invalidate();
}
function paintBackground() {
  const key = `${width}:${height}:${radius}:${dpr}`;
  if (key === backgroundKey) return;
  backgroundKey = key;
  background.width = canvas.width;
  background.height = canvas.height;
  const c = backgroundCtx,
    { x: cx, y: cy } = diskCenter();
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const glow = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
  glow.addColorStop(0, "#182c29");
  glow.addColorStop(0.62, "#142322");
  glow.addColorStop(1, "#111c1d");
  c.beginPath();
  c.arc(cx, cy, radius, 0, Math.PI * 2);
  c.fillStyle = glow;
  c.fill();
  c.strokeStyle = "#a8e6ce0a";
  c.lineWidth = 1;
  for (const distance of [1, 2, 3, 4, 5]) {
    c.beginPath();
    c.arc(cx, cy, radius * Math.tanh(distance / 2), 0, Math.PI * 2);
    c.stroke();
  }
  c.strokeStyle = "#a8e6ce09";
  c.setLineDash([2, 7]);
  c.beginPath();
  c.moveTo(cx - radius, cy);
  c.lineTo(cx + radius, cy);
  c.moveTo(cx, cy - radius);
  c.lineTo(cx, cy + radius);
  c.stroke();
  c.setLineDash([]);
  c.beginPath();
  c.arc(cx, cy, radius, 0, Math.PI * 2);
  c.strokeStyle = "#779a8948";
  c.stroke();
  c.beginPath();
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    c.moveTo(cx + (radius + 5) * Math.cos(a), cy + (radius + 5) * Math.sin(a));
    c.lineTo(
      cx + (radius + (i % 10 === 0 ? 11 : 7)) * Math.cos(a),
      cy + (radius + (i % 10 === 0 ? 11 : 7)) * Math.sin(a),
    );
  }
  c.strokeStyle = "#779a8955";
  c.stroke();
}
// Pull the plane toward the focus: hyperbolic distances beyond `gatherFrom` are scaled by
// `gather` (direction kept), while the focus's own neighbourhood keeps its true shape.
const gatherFrom = 0.8;
function gatherPoint(p: Point): Point {
  if (gather === 1) return p;
  const r = Math.hypot(p.x, p.y);
  if (r < 1e-12) return p;
  const rho = 2 * Math.atanh(Math.min(r, 1 - 1e-15));
  if (rho <= gatherFrom) return p;
  const scaled = Math.tanh((gatherFrom + gather * (rho - gatherFrom)) / 2) / r;
  return { x: p.x * scaled, y: p.y * scaled };
}
function draw(now: number): boolean {
  if (!width || !height) return false;
  renderCount++;
  sampleCamera(now);
  // Hover uses a DOM overlay and never invalidates the scene.
  if (animation) {
    tooltip.hidden = true;
    hoverRing.hidden = true;
    hovered = undefined;
  }
  paintBackground();
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(background, 0, 0, width, height);
  const { x: cx, y: cy } = diskCenter();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const orderParent = selected.parent ?? selected;
  const cos = Math.cos(rotation),
    sin = Math.sin(rotation);
  const projected = tree.nodes.map((node) => {
    const local = gatherPoint(translate(node.position, camera));
    const p = {
      x: local.x * cos - local.y * sin,
      // Reflect the disk vertically so ordered siblings read rightward while children descend.
      y: -(local.x * sin + local.y * cos),
    };
    const metric = Math.max(0, 1 - p.x * p.x - p.y * p.y);
    const x = cx + p.x * radius,
      y = cy + p.y * radius;
    const priority =
      node === selected
        ? -100
        : node.parent === orderParent
          ? -85
          : node.parent === selected
            ? -80
            : node === selected.parent
              ? -70
              : ancestors.has(node.id)
                ? -60
                : nearby(node.id)
                  ? -50 + hops[node.id]
                  : (node.kind === "expression" ? 0 : 2) + 1 - metric;
    return { node, p, x, y, metric, priority };
  });
  // Batch sibling chains separately from parent-child emphasis.
  const addEdge = (
    path: Path2D,
    start: (typeof projected)[number],
    end: (typeof projected)[number],
  ) => {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 1.2) return;
    const arc = geodesicArc(start.p, end.p);
    path.moveTo(start.x, start.y);
    if (!arc || (length * length) / (8 * arc.radius * radius) < 0.25)
      path.lineTo(end.x, end.y);
    else
      path.arc(
        cx + arc.x * radius,
        cy + arc.y * radius,
        arc.radius * radius,
        arc.start,
        arc.end,
        arc.anticlockwise,
      );
  };
  // Siblings: wide translucent bands, thinner where the disk compresses the row.
  const siblingPaths = fadeLevels.map(() =>
    [0, 1].map(() => [new Path2D(), new Path2D(), new Path2D()]),
  );
  for (const [from, to] of siblingEdges) {
    const a = projected[from],
      b = projected[to];
    const metric = Math.min(a.metric, b.metric);
    if (metric * radius < 0.45) continue;
    const layer = a.node.parent === orderParent ? 1 : 0;
    const fade = Math.max(fadeLevel(from), fadeLevel(to));
    addEdge(siblingPaths[fade][layer][metric > 0.55 ? 2 : metric > 0.25 ? 1 : 0], a, b);
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  siblingPaths.forEach((layers, fade) => {
    ctx.globalAlpha = fadeLevels[fade];
    layers.forEach((paths, active) =>
      paths.forEach((path, size) => {
        ctx.strokeStyle = active ? "#c7a0f538" : "#a987d51e";
        ctx.lineWidth = [2.5, 6, 10][size] * (active ? 1.15 : 1);
        ctx.stroke(path);
      }),
    );
  });
  ctx.restore();
  const edges = fadeLevels.map(() => [new Path2D(), new Path2D()]);
  for (const item of projected) {
    const { node } = item;
    if (!node.parent || node.parent.children[0] !== node) continue;
    const active = ancestors.has(node.id) || node.parent === selected;
    const category = active ? 1 : 0;
    addEdge(edges[fadeLevel(node.id)][category], projected[node.parent.id], item);
  }
  // Parent → first child: a crisp line with a dark halo so it cuts cleanly across bands.
  edges.forEach((paths, fade) =>
    paths.forEach((path, i) => {
      ctx.globalAlpha = fadeLevels[fade];
      ctx.strokeStyle = "#0f1a1bcc";
      ctx.lineWidth = i ? 4 : 3;
      ctx.stroke(path);
      ctx.strokeStyle = i ? "#6ff7d6" : "#4fd8bbc8";
      ctx.lineWidth = i ? 1.8 : 1.2;
      ctx.stroke(path);
    }),
  );
  ctx.globalAlpha = 1;
  hitboxes = [];
  const candidates: typeof projected = [];
  const dots = fadeLevels.map(() => [new Path2D(), new Path2D(), new Path2D()]);
  for (const item of projected) {
    const { node, x, y, metric } = item;
    if (x < 0 || x > width || y < 0 || y > height) continue;
    if (metric * radius < 0.45 && node !== selected) continue;
    const category =
      node.kind === "literal" ? 2 : node.kind === "symbol" ? 1 : 0;
    const size =
      category === 0 ? Math.max(1, metric * 3) : Math.max(0.7, metric * 2);
    const dotPath = dots[fadeLevel(node.id)][category];
    dotPath.moveTo(x + size, y);
    dotPath.arc(x, y, size, 0, Math.PI * 2);
    hitboxes.push({ node, x, y, w: 6, h: 6 });
    if (
      readableLabel(
        metric,
        radius,
        category === 0,
        node === selected,
        nearby(node.id),
      )
    )
      candidates.push(item);
  }
  dots.forEach((paths, fade) =>
    paths.forEach((path, i) => {
      ctx.globalAlpha = fadeLevels[fade];
      ctx.fillStyle = ["#a8e6ce99", "#a7bddc88", "#dbbb8388"][i];
      ctx.fill(path);
    }),
  );
  ctx.globalAlpha = 1;
  // Sort only readable candidates. Quantized font sizes allow bounded metric caching.
  candidates.sort((a, b) => {
    // Paint focus last so nearby overlapping tokens cannot cover it.
    if (a.node === selected) return 1;
    if (b.node === selected) return -1;
    return a.priority - b.priority;
  });
  const occupied = new LabelGrid();
  let labels = 0;
  for (const item of candidates) {
    const { node, metric } = item;
    let { x, y } = item;
    const important = node === selected;
    // Labels shrink with the disk's conformal factor, matching the room the layout reserved
    // in hyperbolic units, so laid-out labels stay apart off-centre too.
    const container = isContainer(node);
    // Leaf tokens are drawn larger than other labels (the layout reserves room for it).
    const labelScale =
      Math.max(0.5, Math.min(1, layoutLabelScale * 1.04 * metric)) * (container ? 1 : leafTextScale);
    const font = Math.max(7, Math.round(13 * labelScale));
    const pad = 14 * labelScale;
    const text = container ? "" : leafLabels[node.id];
    const siblings = node.parent?.children ?? [];
    const index = siblingOrder[node.id] - 1;
    const before = projected[(siblings[index - 1] ?? node).id];
    const after = projected[(siblings[index + 1] ?? node).id];
    const textAngle =
      container || important
        ? 0
        : leafLabelAngle(
            after.x - before.x,
            after.y - before.y,
            Math.hypot(item.p.x, item.p.y),
          );
    ctx.font = `400 ${font}px "SFMono-Regular", Consolas, monospace`;
    const w = container
      ? Math.max(4, Math.min(10, metric * 20))
      : Math.min(160 * leafTextScale, measure(text, font, false) + pad);
    const h = container ? w : 19 * labelScale;
    // Leaf pills pivot on (roughly) their first two characters, not their middle, so a
    // rotated token keeps its beginning on the tree and the rest trails along the arc.
    // When sibling order runs leftward on screen, pivot on the last two characters
    // instead, so the pill still trails toward the next sibling as the layout assumed.
    const backward =
      !container &&
      !important &&
      Math.abs(Math.atan2(after.y - before.y, after.x - before.x)) > Math.PI / 2;
    const pivotChars = backward
      ? Array.from(text).slice(-2).join("")
      : Array.from(text).slice(0, 2).join("");
    const shift = container
      ? 0
      : (backward ? -1 : 1) *
        Math.max(0, w / 2 - pad / 2 - measure(pivotChars, font, false) / 2);
    const centerX = x + Math.cos(textAngle) * shift,
      centerY = y + Math.sin(textAngle) * shift;
    const boundsW =
      Math.abs(Math.cos(textAngle)) * w + Math.abs(Math.sin(textAngle)) * h;
    const boundsH =
      Math.abs(Math.sin(textAngle)) * w + Math.abs(Math.cos(textAngle)) * h;
    // Labels stay on the actual AST node. Nearby content may overlap rather than
    // acquiring leader lines that look like extra syntax edges.
    if (
      !container &&
      !important &&
      (centerX + boundsW / 2 < 0 ||
        centerX - boundsW / 2 > width ||
        centerY + boundsH / 2 < 0 ||
        centerY - boundsH / 2 > height)
    )
      continue;
    if (
      !occupied.reserve(
        { x: centerX, y: centerY, w: boundsW, h: boundsH },
        container || important || nearby(node.id),
      )
    )
      continue;
    labels++;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(textAngle);
    ctx.globalAlpha = fadeLevels[fadeLevel(node.id)];
    x = shift;
    y = 0;
    ctx.fillStyle = important
      ? container
        ? "#b3f4df"
        : "#d1e3ff"
      : container
        ? "#13362fef"
        : "#101d2bef";
    ctx.strokeStyle = important
      ? "#ddfff1"
      : `${colors[node.kind]}${container ? "85" : "30"}`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    if (container) ctx.arc(x, y, w / 2, 0, Math.PI * 2);
    else ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = important ? "#11362c" : colors[node.kind];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (!container) ctx.fillText(text, x, y, w - pad);
    ctx.restore();
    hitboxes.push({
      node,
      x: centerX,
      y: centerY,
      w: Math.max(16, w),
      h: Math.max(16, h),
      angle: textAngle,
    });
  }
  ctx.restore();
  if (!animation || now - lastHudTime > 120) {
    lastHudTime = now;
    changedText(visibleCount, `${labels} LABELS`);
    changedText(
      travel,
      `${animation ? "移动中" : "距根节点"} · ${distance(origin, camera).toFixed(2)} 双曲单位`,
    );
  }
  if (!animation) {
    canvas.setAttribute(
      "aria-description",
      `${tree.nodes.length} 个节点，${labels} 个标签。当前焦点：${labelNames[selected.id]}`,
    );
    // Read-only diagnostics, published only after settling (no polling or timers).
    canvas.dataset.renderCount = String(renderCount);
    canvas.dataset.labelCandidates = String(candidates.length);
    canvas.dataset.textCacheSize = String(textWidths.size);
  }
  return !!animation;
}
new ResizeObserver(() => {
  const rect = canvas.getBoundingClientRect();
  const nextDpr = Math.min(devicePixelRatio || 1, 2);
  if (width === rect.width && height === rect.height && nextDpr === dpr) return;
  width = rect.width;
  height = rect.height;
  dpr = nextDpr;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateRadius();
  requestDraw();
}).observe(canvas);
// Content flows rightward and upward from the focus, so sit the disk centre slightly
// left of and below the middle of the screen.
function diskCenter(): Point {
  return { x: width * 0.46, y: height * 0.55 };
}
function updateRadius() {
  radius = Math.max(20, Math.min(width - 36, height - 36) / 2) * zoom;
}
function hit(event: MouseEvent) {
  const rect = canvas.getBoundingClientRect(),
    x = event.clientX - rect.left,
    y = event.clientY - rect.top;
  for (let i = hitboxes.length - 1; i >= 0; i--) {
    const box = hitboxes[i];
    if (containsRotatedBox(box, x, y)) return box;
  }
  return undefined;
}
canvas.addEventListener("click", (e) => {
  const box = hit(e);
  if (box) focus(box.node);
  canvas.focus();
});
let tooltipWidth = 0,
  tooltipHeight = 0;
canvas.addEventListener("mousemove", (event) => {
  if (animation) return;
  const box = hit(event),
    node = box?.node;
  if (node !== hovered) {
    hovered = node;
    canvas.style.cursor = node ? "pointer" : "default";
    tooltip.hidden = !node;
    hoverRing.hidden = !box;
    if (node && box) {
      tooltip.textContent = `${kindNames[node.kind]} · #${node.id}${node.parent ? ` · 同级 ${siblingOrder[node.id]}/${node.parent.children.length}` : ""}\n${fullContent(node)}`;
      tooltip.scrollTop = 0;
      tooltipWidth = tooltip.offsetWidth;
      tooltipHeight = tooltip.offsetHeight;
      // Anchor to the hitbox with a small overlap, so the pointer can enter and scroll it.
      const right = box.x + box.w / 2 - 3;
      const tx = Math.max(
        8,
        right + tooltipWidth > width - 8
          ? box.x - box.w / 2 - tooltipWidth + 3
          : right,
      );
      const ty = Math.max(
        8,
        Math.min(box.y - box.h / 2, height - tooltipHeight - 8),
      );
      tooltip.style.transform = `translate(${tx}px, ${ty}px)`;
      hoverRing.style.left = `${box.x - box.w / 2 - 2}px`;
      hoverRing.style.top = `${box.y - box.h / 2 - 2}px`;
      hoverRing.style.width = `${box.w + 4}px`;
      hoverRing.style.height = `${box.h + 4}px`;
      hoverRing.style.transform = `rotate(${box.angle ?? 0}rad)`;
    }
  }
});
canvas.addEventListener("mouseleave", (event) => {
  if (
    event.relatedTarget instanceof Node &&
    tooltip.contains(event.relatedTarget)
  )
    return;
  hovered = undefined;
  tooltip.hidden = true;
  hoverRing.hidden = true;
});
tooltip.addEventListener("mouseleave", () => {
  hovered = undefined;
  tooltip.hidden = true;
  hoverRing.hidden = true;
});
document.addEventListener("visibilitychange", () =>
  scheduler.setVisible(!document.hidden),
);
scheduler.setVisible(!document.hidden);
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (
    e.target instanceof HTMLElement &&
    (e.target.closest("input, textarea, select") || e.target.isContentEditable)
  )
    return;
  if (e.key.toLowerCase() === "f") {
    e.preventDefault();
    toggleFocus();
    return;
  }
  if (e.key === "Escape" && focusMode) {
    e.preventDefault();
    toggleFocus();
    return;
  }
  if (e.target instanceof HTMLElement && e.target.closest("button, a")) return;
  let next: SyntaxNode | undefined;
  if (e.key === "ArrowUp") next = selected.parent;
  else if (e.key === "ArrowDown") next = selected.children[0];
  else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const siblings = selected.parent?.children ?? [selected],
      i = siblings.indexOf(selected);
    next = siblings[i + (e.key === "ArrowRight" ? 1 : -1)];
  } else if (e.key === "Home" || e.key === "Escape") next = tree.root;
  else return;
  e.preventDefault();
  if (next) focus(next);
});
$("#reset").onclick = () => {
  focus(tree.root);
  canvas.focus();
};
function editing(value: boolean) {
  $("#editor").hidden = !value;
  $("#source").hidden = value;
  $("#edit").hidden = value;
  if (value) {
    $<HTMLTextAreaElement>("#input").value = source;
    $("#error").textContent = "";
    $("#input").focus();
  }
}
$("#edit").onclick = () => editing(true);
$("#cancel").onclick = () => editing(false);
function load(text: string) {
  const parsed = parse(text);
  layout(parsed.root, spacing);
  source = text;
  tree = parsed;
  siblingEdges = siblingPairs();
  siblingOrder = indexSiblings();
  labelNames = tree.nodes.map(label);
  leafLabels = tree.nodes.map((node) => shortLeaf(node.text));
  textWidths.clear();
  ancestors = new Set([tree.root.id]);
  camera = { ...origin };
  animation = undefined;
  selected = tree.root;
  hops = hopsFrom(selected);
  rotation = readingRotation(selected);
  renderSource();
  syncPanels();
  requestDraw();
  editing(false);
}
$("#apply").onclick = () => {
  try {
    load($<HTMLTextAreaElement>("#input").value);
  } catch (error) {
    $("#error").textContent = (error as Error).message;
  }
};
select.onchange = () => load(examples[select.value as keyof typeof examples]);
function togglePanel(kind: "source" | "detail", open?: boolean) {
  const panel = $(`#${kind}-panel`),
    visible = open ?? panel.hidden;
  panel.hidden = !visible;
  $(`#toggle-${kind}`).setAttribute("aria-expanded", String(visible));
  if (visible && innerWidth < 850) {
    const other = kind === "source" ? "detail" : "source";
    $(`#${other}-panel`).hidden = true;
    $(`#toggle-${other}`).setAttribute("aria-expanded", "false");
  }
}
function toggleFocus() {
  focusMode = !focusMode;
  document.body.classList.toggle("focus-mode", focusMode);
  $("#focus-mode").setAttribute("aria-pressed", String(focusMode));
  $("#focus-mode").textContent = focusMode
    ? "⛶ 退出专注 · F"
    : "⛶ 专注模式 · F";
  canvas.focus({ preventScroll: true });
}
for (const kind of ["source", "detail"] as const) {
  $(`#toggle-${kind}`).onclick = () => togglePanel(kind);
  $(`#close-${kind}`).onclick = () => togglePanel(kind, false);
}
$("#focus-mode").onclick = toggleFocus;
function setZoom(value: number) {
  const nextZoom = Math.max(0.6, Math.min(1.8, value));
  if (nextZoom === zoom) return;
  zoom = nextZoom;
  $<HTMLInputElement>("#zoom").value = String(zoom);
  $("#zoom-value").textContent = `${zoom.toFixed(2)}×`;
  updateRadius();
  requestDraw();
}
$<HTMLInputElement>("#zoom").oninput = (event) =>
  setZoom(Number((event.target as HTMLInputElement).value));
$<HTMLInputElement>("#gather").oninput = (event) => {
  gather = Number((event.target as HTMLInputElement).value);
  $("#gather-value").textContent = gather.toFixed(2);
  requestDraw();
};
canvas.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    setZoom(zoom - event.deltaY * 0.001);
  },
  { passive: false },
);
renderSource();
syncPanels();
requestDraw();
