import {
  parse,
  examples,
  layout,
  translate,
  norm,
} from "../src/core.ts";
const { root, nodes } = parse(examples["Soluble · 应用全景"]);
const focuses = [
  root,
  ...nodes.filter((n) => n.children.length >= 4 && n.depth <= 6).slice(0, 14),
];
// The layout has one knob left: the spacing slider.
const variants: Record<string, number> = { tight: 0.45, default: 0.5, loose: 0.85 };
for (const [name, spacing] of Object.entries(variants)) {
  layout(root, spacing);
  let close = 0,
    visible = 0;
  for (const focus of focuses) {
    const points = nodes
      .map((node) => ({ node, p: translate(node.position, focus.position) }))
      .filter((v) => norm(v.p) < 0.9);
    visible += points.length;
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i],
          b = points[j];
        const width = (n: typeof root) =>
          n.kind === "expression" || n.kind === "root"
            ? 12
            : 14 + Math.min(16, n.text.length) * 6;
        // Isotropic footprint estimate, independent of screen rotation. Not a full label-layout benchmark.
        const gap = (width(a.node) + width(b.node)) * 0.22 + 6;
        if (Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) * 500 < gap) close++;
      }
  }
  console.log(
    JSON.stringify({
      name,
      views: focuses.length,
      meanVisible: Math.round(visible / focuses.length),
      closePairsPer100Nodes: Math.round((close / visible) * 100),
    }),
  );
}
