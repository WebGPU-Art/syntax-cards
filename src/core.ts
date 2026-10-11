import { parse as parseCirru, type ICirruNode } from "@cirru/parser.ts";
import repositoryExamples from "./repository-examples.json";
export type Point = { x: number; y: number };
export const origin: Point = { x: 0, y: 0 };
export const norm = (p: Point) => Math.hypot(p.x, p.y);
export const scale = (p: Point, s: number): Point => ({
  x: p.x * s,
  y: p.y * s,
});
/** Disk isometry taking a to zero: (z-a)/(1-conj(a)z). */
export function translate(z: Point, a: Point): Point {
  const x = z.x - a.x,
    y = z.y - a.y;
  const u = 1 - a.x * z.x - a.y * z.y,
    v = a.y * z.x - a.x * z.y;
  const d = u * u + v * v;
  return { x: (x * u + y * v) / d, y: (y * u - x * v) / d };
}
export function geodesic(a: Point, b: Point, t: number): Point {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const local = translate(b, a),
    r = norm(local);
  if (r < 1e-12) return { ...a };
  return translate(
    scale(local, Math.tanh(t * Math.atanh(Math.min(r, 1 - 1e-14))) / r),
    scale(a, -1),
  );
}
export const distance = (a: Point, b: Point) =>
  2 * Math.atanh(Math.min(norm(translate(b, a)), 1 - 1e-14));
export type SyntaxNode = {
  id: number;
  kind: "root" | "expression" | "symbol" | "literal";
  text: string;
  line: number;
  depth: number;
  parent?: SyntaxNode;
  children: SyntaxNode[];
  position: Point;
};
/** Keep sibling order rightward, biasing branches toward their first downward child. */
export function readingRotation(node: SyntaxNode, fallback = 0): number {
  const siblings = node.parent?.children ?? [];
  const index = siblings.indexOf(node);
  const next = siblings[index + 1];
  const previous = siblings[index - 1];
  const child = node.children[0];
  const downward = child ? translate(child.position, node.position) : undefined;
  const childRotation = downward
    ? -Math.PI / 2 - Math.atan2(downward.y, downward.x)
    : undefined;
  const neighbor = next ?? previous;
  if (neighbor) {
    const direction = translate(neighbor.position, node.position);
    if (!next) {
      direction.x *= -1;
      direction.y *= -1;
    }
    const horizontal =
      norm(direction) < 1e-10
        ? fallback
        : -Math.atan2(direction.y, direction.x);
    if (childRotation === undefined) return horizontal;
    // Branches favor ↓ while keeping the next sibling in the right half of the view.
    const turn = angleDelta(horizontal, childRotation);
    // Lean strongly toward ↓ for the first child; the next sibling stays right of centre.
    const limit = (75 * Math.PI) / 180;
    return horizontal + Math.max(-limit, Math.min(limit, turn));
  }
  if (childRotation !== undefined) return childRotation;
  if (node.parent) {
    const back = translate(node.parent.position, node.position);
    return Math.PI / 2 - Math.atan2(back.y, back.x);
  }
  return fallback;
}
export const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function label(node: SyntaxNode): string {
  if (node.kind === "root") return "module";
  if (node.kind !== "expression") return node.text;
  return (
    node.children
      .slice(0, 3)
      .map((n) => (n.kind === "expression" ? "(…)" : n.text))
      .join(" ") || "( )"
  );
}
/** Official Cirru reader; the source-token cursor adds locations to its ordered AST. */
export function parse(source: string): {
  root: SyntaxNode;
  nodes: SyntaxNode[];
} {
  if (source.length > 80000) throw new Error("最多支持 80,000 个字符。");
  const locations: { text: string; line: number }[] = [];
  source.split("\n").forEach((line, index) => {
    if (line.includes("\t"))
      throw new Error(`第 ${index + 1} 行：请使用空格缩进。`);
    for (const match of line.matchAll(/"(?:\\.|[^"\\])*"|[()$]|[^\s()$]+/g)) {
      const raw = match[0];
      if (["$", ",", "(", ")"].includes(raw)) continue;
      let text = raw;
      if (raw.startsWith('"')) {
        try {
          text = JSON.parse(raw) as string;
        } catch {
          throw new Error(`第 ${index + 1} 行：字符串未闭合或转义无效。`);
        }
      }
      locations.push({ text, line: index + 1 });
    }
  });
  let ast: ICirruNode[];
  try {
    ast = parseCirru(source);
  } catch (error) {
    throw new Error(`Cirru 解析失败：${String(error)}`);
  }
  const nodes: SyntaxNode[] = [];
  const root: SyntaxNode = {
    id: 0,
    kind: "root",
    text: "module",
    line: 0,
    depth: 0,
    children: [],
    position: origin,
  };
  nodes.push(root);
  let cursor = 0;
  const visit = (value: ICirruNode, parent: SyntaxNode): SyntaxNode => {
    if (nodes.length >= 4000) throw new Error("最多支持 4,000 个语法节点。");
    if (parent.depth >= 32) throw new Error("最多支持 32 层语法嵌套。");
    const isList = Array.isArray(value);
    const node: SyntaxNode = {
      id: nodes.length,
      kind: isList
        ? "expression"
        : /^(?:\||:|-?\d)|^(true|false|nil)$/.test(value as string)
          ? "literal"
          : "symbol",
      text: isList ? "" : (value as string),
      line: locations[cursor]?.line ?? parent.line,
      depth: parent.depth + 1,
      parent,
      children: [],
      position: origin,
    };
    nodes.push(node);
    parent.children.push(node);
    if (isList) {
      for (const child of value) visit(child, node);
      node.line = node.children[0]?.line ?? node.line;
    } else {
      // Cirru preserves leaf order even when $ and comma fold expressions.
      const found = locations.findIndex(
        (token, i) => i >= cursor && token.text === value,
      );
      if (found >= 0) {
        node.line = locations[found].line;
        cursor = found + 1;
      }
    }
    return node;
  };
  ast.forEach((value) => visit(value, root));
  layout(root);
  return { root, nodes };
}
/** A subtree's footprint in its root's frame: label discs with hyperbolic radius `r`. */
type Footprint = {
  x: number;
  y: number;
  r: number;
  /** Label radius before distance falloff. */
  base?: number;
  /** Reading distance from the subtree root (first child +1, each next sibling +0.8). */
  reach?: number;
  /** Leaf pills seen from their own parent: extents along the arc and across it. */
  left?: number;
  right?: number;
  half?: number;
}[];
/** Hyperbolic units per CSS px near the focus (disk radius ≈ 540px at the default zoom). */
const pxUnit = 1 / 270;
/** Share of a label's full-size footprint the layout reserves (renderer matches it). */
export const labelScale = 0.8;
/** Leaf tokens are drawn this much larger than other labels. */
export const leafTextScale = 1.6;
/**
 * How far (in reading distance: parent → first child 1, sibling → next sibling 0.8) below
 * a junction its content still shapes the junction. Farther content barely matters.
 */
const footprintReach = 3.5;
/** Shortest parent → child edge (hyperbolic units). */
const minEdge = 0.3;
/** Beyond `footprintReach`, content up to this distance still nudges branches apart. */
const farReach = 7;
/** Placeholder size (share of a label) at `footprintReach`, shrinking to 0 at `farReach`. */
const farScale = 0.3;
/** Node distance from one sibling to the next (parent → first child is 1). */
export const siblingStep = 0.8;
/** Longest edge for the first child (node distance 1). */
const headReach = 0.75;
/** How much further each unit of node distance may reach (0.3 per sibling at 0.8). */
const recedeRate = 0.375;
export function labelRadius(node: SyntaxNode, _spacing = 0.5): number {
  const px =
    node.kind === "root"
      ? 10
      : node.kind === "expression"
        ? 7
        : // Disc around the 19px-high pill, so its corners are covered too.
          leafTextScale * Math.hypot((14 + Math.min(16, Array.from(node.text).length) * 7.5) / 2, 9.5);
  // Labels reserve 80% of their full-size footprint: the renderer draws them slightly
  // smaller (≈ 11px at the focus), which keeps more of the program near the centre.
  // Labels keep their size; `spacing` only widens the margins between them.
  return labelScale * px * pxUnit;
}
/**
 * A leaf pill along its sibling arc: it pivots on its first two characters, so it reaches
 * a little behind the node and most of its width ahead (toward the next sibling).
 */
export function leafExtent(node: SyntaxNode) {
  const chars = Math.min(16, Array.from(node.text).length);
  const width = leafTextScale * (14 + chars * 7.8);
  const anchor = Math.min(width / 2, leafTextScale * (7 + Math.min(2, chars) * 3.9));
  const gap = 5;
  const across = leafTextScale * 14;
  const k = labelScale * pxUnit;
  return {
    left: (anchor + gap) * k,
    right: (width - anchor + gap) * k,
    half: across * k,
  };
}
/** Angular interval [lo, hi] that a footprint occupies, seen from a point `d` behind its root. */
export function footprintSpan(foot: Footprint, d: number) {
  const t = Math.tanh(d / 2);
  let lo = Infinity,
    hi = -Infinity,
    inner = Infinity,
    outer = 0;
  for (const p of foot) {
    // Move the subtree root from the origin to (t, 0); the viewer stays at the origin.
    const q = translate(p, { x: -t, y: 0 });
    const rho = 2 * Math.atanh(Math.min(norm(q), 1 - 1e-15));
    const angle = Math.atan2(q.y, q.x);
    const cone = (r: number) =>
      rho > r ? Math.asin(Math.min(1, Math.sinh(r) / Math.sinh(rho))) : Math.PI / 2;
    const across = p.half ?? p.r;
    // Pills are straight segments along the tangent: seen from the parent, a segment of
    // length L at distance rho spans atan(tanh L / sinh rho) (a right triangle).
    const segment = (length: number) => Math.atan(Math.tanh(length) / Math.sinh(rho));
    lo = Math.min(lo, angle - (p.left === undefined ? cone(p.r) : segment(p.left)));
    hi = Math.max(hi, angle + (p.right === undefined ? cone(p.r) : segment(p.right)));
    inner = Math.min(inner, rho - across);
    // A pill runs along the tangent, so its ends sit further out than its centre.
    const reach = Math.max(p.left ?? 0, p.right ?? 0);
    outer = Math.max(outer, Math.acosh(Math.cosh(rho) * Math.cosh(reach)) + across);
  }
  return { lo, hi, width: hi - lo, inner, outer };
}
const rotate = (p: { x: number; y: number }, angle: number) => ({
  x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
});
/** Keep large footprints bounded: per angular bin, keep the nearest and the farthest disc. */
function thin(foot: Footprint): Footprint {
  if (foot.length <= 320) return foot;
  const bins = new Map<number, Footprint>();
  for (const p of foot) {
    const key = Math.floor(((Math.atan2(p.y, p.x) + Math.PI) / (2 * Math.PI)) * 96);
    const bin = bins.get(key);
    if (!bin) bins.set(key, [p, p]);
    else {
      const d = norm(p);
      if (d < norm(bin[0])) bin[0] = p;
      if (d > norm(bin[1])) bin[1] = p;
    }
  }
  return [...bins.values()].flatMap((bin) => (bin[0] === bin[1] ? [bin[0]] : bin));
}
/**
 * Content-aware hyperbolic layout.
 *
 * Bottom-up, every subtree is laid out in its own frame (root at the origin, growing
 * toward +x) and summarised as a footprint of label discs. A parent then measures the
 * exact angle each child's footprint covers from its own position, which shrinks as
 * the child moves outward (≈ sinh r / sinh d). Children start as close as their labels
 * allow, and only crowded junctions push children outward, the crowded ones the most,
 * until the ordered fan fits. Sparse branches therefore stay near, dense ones get longer
 * edges, and sibling subtrees occupy disjoint angular wedges, so they cannot overlap.
 */
export function layout(root: SyntaxNode, spacing = 0.6) {
  // Negative at the tightest settings (labels may touch), never below −4px.
  const margin = Math.max(-4 * pxUnit, 0.8 * (14 * pxUnit * Math.pow(spacing / 0.5, 2) - 7 * pxUnit));
  const fanLimit = 2.9;
  const local = new Map<number, { d: number; theta: number }>();
  const visit = (node: SyntaxNode): Footprint => {
    const own = { x: 0, y: 0, r: labelRadius(node, spacing) };
    if (!node.children.length) return [{ ...own, ...leafExtent(node) }];
    const feet = node.children.map(visit);
    const n = node.children.length;
    // A leaf only needs to clear its parent across its pill height.
    const clearance = (child: SyntaxNode) =>
      own.r +
      (child.children.length
        ? labelRadius(child, spacing)
        : Math.max(leafExtent(child).half, 0.5 * labelRadius(child, spacing))) +
      margin;
    // Every level, the module root included, follows the same rules.
    const limit = fanLimit;
    // Every child starts as close as its label allows. Only when the fan does not fit do
    // edges grow, all by the same amount, each capped by its node-distance budget. How much
    // a branch needs comes only from its footprint, which already fades with node distance,
    // never from how many nodes the branch holds.
    // A floor keeps short edges readable: a token never sits right on top of its parent.
    const lows = node.children.map((child) => Math.max(minEdge, clearance(child)));
    type Slot = { d: number; theta: number; lo: number; width: number };
    // Pack footprints in source order; a child only clears earlier siblings whose radial
    // band it shares, and centres always advance, so syntax order never doubles back.
    const pack = (offset: number) => {
      const slots: Slot[] = [];
      const bands: { inner: number; outer: number; end: number }[] = [];
      let start = 0,
        previous = -Infinity;
      for (let i = 0; i < n; i++) {
        // One budget by node distance: the child at node distance 1 + siblingStep·i may sit
        // at most `headReach + recedeRate·siblingStep·i` from its parent. The head stays
        // close, and a crowded list spirals outward gradually instead of every sibling
        // jumping to the rim together.
        const budget = headReach + recedeRate * siblingStep * i;
        const d0 = Math.max(lows[i], Math.min(lows[i] + offset, budget));
        const settle = (d: number) => {
          const span = footprintSpan(feet[i], d);
          let from = Math.max(start, previous + 2e-3 + span.lo);
          for (const band of bands.slice(-16))
            if (band.inner < span.outer && span.inner < band.outer)
              from = Math.max(from, band.end);
          return { d, span, from };
        };
        let placed = settle(d0);
        // Parent → head → second sibling must open to at least 80°: a narrow wedge there
        // squeezes the two first branches together. Push the second sibling out until it
        // does (bounded).
        if (i === 1) {
          const head = slots[0];
          const at = scale({ x: Math.cos(head.theta), y: Math.sin(head.theta) }, Math.tanh(head.d / 2));
          const opening = (p: typeof placed) => {
            const theta = p.from - p.span.lo;
            const next = scale({ x: Math.cos(theta), y: Math.sin(theta) }, Math.tanh(p.d / 2));
            const toParent = translate(origin, at),
              toNext = translate(next, at);
            return Math.abs(angleDelta(Math.atan2(toParent.y, toParent.x), Math.atan2(toNext.y, toNext.x)));
          };
          for (let k = 0; k < 150 && opening(placed) < (80 * Math.PI) / 180; k++)
            placed = settle(placed.d + 0.03);
        }
        const { span, from } = placed;
        const d = placed.d;
        const slot = { d, theta: from - span.lo, lo: from, width: span.width };
        slots.push(slot);
        bands.push({ inner: span.inner, outer: span.outer, end: from + span.width });
        start = from + 1e-3;
        previous = slot.theta;
      }
      // Sharpest turn of the sibling chain, measured at each sibling in its own frame.
      const points = slots.map((slot) =>
        scale({ x: Math.cos(slot.theta), y: Math.sin(slot.theta) }, Math.tanh(slot.d / 2)),
      );
      let bend = 0;
      for (let i = 1; i < n - 1; i++) {
        const back = translate(points[i - 1], points[i]);
        const ahead = translate(points[i + 1], points[i]);
        bend = Math.max(
          bend,
          Math.abs(angleDelta(Math.atan2(back.y, back.x) + Math.PI, Math.atan2(ahead.y, ahead.x))),
        );
      }
      return { slots, width: Math.max(...bands.map((band) => band.end)), bend };
    };
    // Only if the whole fan still does not fit, lengthen every edge by the same amount.
    let offset = 0;
    let packed = pack(0);
    if (packed.width > limit) {
      let low = 0,
        high = 0.5;
      while (pack(high).width > limit && high < 12) high *= 2;
      for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        if (pack(mid).width > limit) low = mid;
        else high = mid;
      }
      offset = high;
      packed = pack(offset);
    }
    // Aim for sibling turns under 60° by lengthening a little more (bounded).
    const maxBend = Math.PI / 3 - 0.01;
    if (packed.bend > maxBend) {
      let best = packed;
      for (let k = 1; k <= 25 && best.bend > maxBend; k++) {
        const trial = pack(offset + k * 0.06);
        if (trial.bend < best.bend) best = trial;
      }
      packed = best;
    }
    const { slots, width } = packed;
    const result: Footprint = [own];
    node.children.forEach((child, i) => {
      const { d } = slots[i];
      // The head points nearly straight away from the parent (within 0.4 rad), so the
      // first-child edge meets both sibling links at a wide angle (≈ 90–120°) instead of
      // hugging the previous one; the fan opens toward the next sibling but not past
      // ~2.1 rad (120°), so little curls back toward the parent.
      const span = width - slots[0].theta + slots[0].lo;
      const head = -Math.min(Math.max(span - 2.1, Math.min(span / 2, 0.4)), span / 2);
      const theta = slots[i].theta - slots[0].theta + head;
      local.set(child.id, { d, theta });
      const t = Math.tanh(d / 2);
      const offset = { x: -t * Math.cos(theta), y: -t * Math.sin(theta) };
      for (const p of feet[i]) {
        const q = translate(rotate(p, theta), offset);
        // Influence fades fast with reading distance, the same measure the renderer fades
        // by: a junction only makes room for what lies a few steps away along the code.
        const reach = (p.reach ?? 0) + 1 + siblingStep * i;
        // Near content keeps its full label size; beyond `footprintReach` it still pushes
        // branches apart, but only with a shrinking placeholder, and past `farReach` not at all.
        if (reach > farReach) continue;
        const base = p.base ?? p.r;
        const falloff =
          reach <= footprintReach ? 1 : farScale * (1 - (reach - footprintReach) / (farReach - footprintReach));
        result.push({ x: q.x, y: q.y, r: base * falloff, base, reach });
      }
    });
    return thin(result);
  };
  visit(root);
  // Top-down: compose the local frames into disk coordinates.
  root.position = origin;
  const place = (node: SyntaxNode, heading: number) => {
    for (const child of node.children) {
      const { d, theta } = local.get(child.id)!;
      const t = Math.tanh(d / 2);
      child.position = translate(
        { x: t * Math.cos(heading + theta), y: t * Math.sin(heading + theta) },
        scale(node.position, -1),
      );
      if (norm(child.position) >= 1 - 1e-12)
        throw new Error("语法树超过当前布局的数值精度。");
      const back = translate(node.position, child.position);
      place(child, Math.atan2(back.y, back.x) + Math.PI);
    }
  };
  place(root, -Math.PI / 2);
}
export const repositorySources = repositoryExamples;
export const examples: Record<string, string> = {
  ...Object.fromEntries(
    repositoryExamples.map((example) => [example.title, example.code]),
  ),
  递归与分支: `; A small program, an infinite space.
ns garden.core

defn grow (seed depth)
  if (<= depth 0)
    leaf seed
    branch
      grow (+ seed 1) (- depth 1)
      grow (* seed 2) (- depth 1)

defn render (state)
  let
    tree $ grow (:seed state) 4
    scene
      background :ink
      draw tree
        color :mint
        width 2`,
  数据与变换: `ns flow.core

defn visible-items (items query)
  -> items
    filter $ fn (item)
      includes? (:title item) query
    sort-by :created-at
    take 12

defn view (items)
  column
    text "A quiet collection"
    map items $ fn (item)
      card
        text (:title item)
        badge (:category item)`,
  斐波那契: `ns math.core

defn fib (n)
  if (< n 2)
    identity n
    +
      fib (- n 1)
      fib (- n 2)

defn main ()
  map (range 8) fib`,
};
