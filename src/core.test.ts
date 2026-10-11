import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseCirru } from "@cirru/parser.ts";
import { readFileSync, existsSync } from "node:fs";
import {
  translate,
  readingRotation,
  angleDelta,
  geodesic,
  distance,
  norm,
  parse,
  examples,
  scale,
  layout,
  labelRadius,
  leafExtent,
  footprintSpan,
  label,
  repositorySources,
  type SyntaxNode,
} from "./core.ts";
const near = (a: number, b: number, eps = 1e-8) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
test("Möbius translation centers focus, inverts and preserves hyperbolic distance", () => {
  const a = { x: 0.6, y: -0.3 },
    p = { x: -0.4, y: 0.7 },
    q = { x: 0.2, y: 0.1 };
  near(norm(translate(a, a)), 0);
  const back = translate(translate(p, a), scale(a, -1));
  near(back.x, p.x);
  near(back.y, p.y);
  near(distance(p, q), distance(translate(p, a), translate(q, a)));
});
test("geodesic interpolation stays inside disk and advances proportional to distance", () => {
  const a = { x: 0.91, y: 0.3 },
    b = { x: -0.85, y: -0.4 };
  for (let i = 0; i <= 20; i++) {
    const p = geodesic(a, b, i / 20);
    assert.ok(norm(p) < 1);
    near(distance(a, p), (distance(a, b) * i) / 20);
  }
});
test("parser keeps indentation, inline groups, $, token order and source lines", () => {
  const { root } = parse("defn f (x)\n  print $ + x 1");
  const fn = root.children[0];
  assert.equal(fn.children[2].children[0].text, "x");
  const body = fn.children[3];
  assert.equal(body.line, 2);
  assert.deepEqual(
    body.children[1].children.map((n) => n.text),
    ["+", "x", "1"],
  );
});
test("all examples have finite layouts and each node can become the exact focus", () => {
  for (const example of Object.values(examples)) {
    const { nodes } = parse(example);
    for (const node of nodes) {
      assert.ok(norm(node.position) < 1);
      near(norm(translate(node.position, node.position)), 0);
      for (const other of nodes)
        assert.ok(norm(translate(other.position, node.position)) < 1);
    }
  }
});
test("official reader supports indentation groups and comma folding; invalid input is bounded", () => {
  for (const text of [
    "f (x",
    "f x)",
    'f "oops',
    "f\n\tg",
    "x ".repeat(4100),
    "x".repeat(80001),
  ])
    assert.throws(() => parse(text));
  assert.equal(parse("").nodes.length, 1);
  const tree = parse("let\n    x 1\n  + x\n    , 2");
  assert.equal(
    tree.root.children[0].children[1].children[0].children[0].text,
    "x",
  );
  assert.ok(tree.nodes.some((n) => n.text === "2"));
  assert.ok(!tree.nodes.some((n) => n.text === ","));
});
test("repository fixtures preserve exact excerpt bodies and complete Cirru ASTs", () => {
  const originalPath = new URL("../../soluble/calcit.cirru", import.meta.url);
  const original = existsSync(originalPath)
    ? readFileSync(originalPath, "utf8").split("\n")
    : undefined;
  const serialize = (node: SyntaxNode): unknown =>
    node.kind === "root" || node.kind === "expression"
      ? node.children.map(serialize)
      : node.text;
  for (const example of repositorySources) {
    for (const excerpt of original ? example.excerpts : []) {
      const lines = original!.slice(excerpt.line - 1, excerpt.endLine);
      const extracted = [
        lines[0].split(":code $ quote $ ")[1],
        ...lines.slice(1).map((line) => line.slice(10)),
      ].join("\n");
      assert.equal(excerpt.code, extracted);
    }
    const tree = parse(example.code);
    assert.deepEqual(serialize(tree.root), parseCirru(example.code));
    assert.ok(
      tree.nodes
        .filter((n) => n.kind === "symbol" || n.kind === "literal")
        .every((n) => n.line > 0),
    );
  }
  const { nodes } = parse(examples["Soluble · 应用全景"]);
  assert.ok(nodes.length >= 1000);
  assert.ok(Math.max(...nodes.map((n) => n.depth)) > 20);
});
test("complex layouts remain finite across spacing settings and deepest-node transitions", () => {
  const { root, nodes } = parse(examples["Soluble · 应用全景"]);
  const deepest = nodes.reduce((a, b) => (a.depth > b.depth ? a : b));
  for (const spacing of [0.45, 0.6, 0.85]) {
    layout(root, spacing);
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const camera = geodesic(root.position, deepest.position, t);
      for (const node of nodes) {
        const p = translate(node.position, camera);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
        assert.ok(norm(p) <= 1 + 1e-6);
      }
    }
    near(norm(translate(deepest.position, deepest.position)), 0);
  }
});

test("deep focus retains local neighbors instead of stretching edges to infinity", () => {
  for (const spacing of [0.45, 0.6, 0.85]) {
    const { root, nodes } = parse(examples["Soluble · 应用全景"]);
    layout(root, spacing);
    for (const node of nodes) {
      if (!node.parent) continue;
      assert.ok(
        distance(node.position, node.parent.position) < 6,
        `edge at depth ${node.depth} is too long`,
      );
    }
  }
});

test("sparse expressions keep their children close; crowded junctions push outward", () => {
  const edges = (source: string) => {
    const { root } = parse(source);
    layout(root, 0.5);
    const expression = root.children[0];
    return expression.children.map((child) =>
      distance(expression.position, child.position),
    );
  };
  for (const d of edges("f a b c")) assert.ok(d < 0.5, "few tokens sit near");
  const crowded = edges(
    "case x " + Array.from({ length: 40 }, (_, i) => `(:key-${i} value-${i})`).join(" "),
  );
  assert.ok(Math.max(...crowded) > 1, "a crowded junction uses longer edges");
  assert.ok(Math.max(...crowded) < 4.5);
});

test("sibling chains bend smoothly, never fold back (at most 100 degrees)", () => {
  for (const example of Object.values(examples))
    for (const spacing of [0.45, 0.6, 0.85]) {
      const { root, nodes } = parse(example);
      layout(root, spacing);
      // Top-level forms ring the module root rather than forming a reading chain.
      for (const parent of nodes.filter((n) => n.parent && n.children.length >= 3))
        // The head may sit much closer than the rest of the arc; the vertex right after it
        // is where the chain leaves the head, so the bound applies from there on.
        for (let i = 2; i < parent.children.length - 1; i++) {
          const at = parent.children[i].position;
          const back = translate(parent.children[i - 1].position, at);
          const ahead = translate(parent.children[i + 1].position, at);
          const turn = Math.abs(
            angleDelta(
              Math.atan2(back.y, back.x) + Math.PI,
              Math.atan2(ahead.y, ahead.x),
            ),
          );
          assert.ok(turn <= (100 * Math.PI) / 180, `${label(parent)} bends ${turn}`);
        }
    }
});

test("most sibling turns stay under 60 degrees", () => {
  const turns: number[] = [];
  for (const example of Object.values(examples)) {
    const { root, nodes } = parse(example);
    layout(root, 0.5);
    for (const parent of nodes)
      for (let i = 1; i < parent.children.length - 1; i++) {
        const at = parent.children[i].position;
        const back = translate(parent.children[i - 1].position, at);
        const ahead = translate(parent.children[i + 1].position, at);
        turns.push(
          Math.abs(angleDelta(Math.atan2(back.y, back.x) + Math.PI, Math.atan2(ahead.y, ahead.x))),
        );
      }
  }
  const gentle = turns.filter((turn) => turn <= Math.PI / 3).length;
  assert.ok(gentle / turns.length > 0.85, `only ${gentle}/${turns.length} turns under 60°`);
});

test("parent, first child and second child open to at least 80 degrees", () => {
  for (const example of Object.values(examples))
    for (const spacing of [0.45, 0.6, 0.85]) {
      const { root, nodes } = parse(example);
      layout(root, spacing);
      for (const parent of nodes) {
        if (!parent.parent || parent.children.length < 2) continue;
        const head = parent.children[0].position;
        const back = translate(parent.position, head);
        const next = translate(parent.children[1].position, head);
        const opening = Math.abs(angleDelta(Math.atan2(back.y, back.x), Math.atan2(next.y, next.x)));
        assert.ok(opening >= (80 * Math.PI) / 180 - 1e-6, `${label(parent)} opens ${opening}`);
      }
    }
});

test("labels near each junction never overlap in hyperbolic space", () => {
  for (const example of Object.values(examples)) {
    const { root, nodes } = parse(example);
    layout(root, 0.5);
    const radii = nodes.map((node) => labelRadius(node, 0.5));
    const ancestors = (node: SyntaxNode) => {
      const set = new Set<SyntaxNode>();
      for (let n = node.parent; n; n = n.parent) set.add(n);
      return set;
    };
    const lineage = nodes.map(ancestors);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        // A leaf is packed as a pill along its parent's arc; it is checked below instead.
        const leafAtJunction = (leaf: SyntaxNode, other: SyntaxNode) =>
          !leaf.children.length && (other === leaf.parent || lineage[other.id].has(leaf.parent!));
        if (leafAtJunction(a, b) || leafAtJunction(b, a)) continue;
        // Siblings make room for what lies within reading distance 3.5 below them; farther
        // cousins are faded out around any focus and may brush against each other.
        const branchRoot = (node: SyntaxNode, other: SyntaxNode) => {
          let n = node;
          while (n.parent && !lineage[other.id].has(n.parent) && n.parent !== other) n = n.parent;
          return n;
        };
        // Reading distance below the branch root: first child +1, each next sibling +0.8.
        const reach = (node: SyntaxNode, top: SyntaxNode) => {
          let total = 0;
          for (let n = node; n !== top && n.parent; n = n.parent)
            total += 1 + 0.8 * n.parent.children.indexOf(n);
          return total;
        };
        if (reach(a, branchRoot(a, b)) > 3.5 || reach(b, branchRoot(b, a)) > 3.5) continue;
        assert.ok(
          distance(a.position, b.position) > (radii[i] + radii[j]) * 0.9,
          `${label(a)} overlaps ${label(b)}`,
        );
      }
    // Consecutive leaf pills along an arc: their angular extents, seen from the parent, never meet.
    for (const parent of nodes)
      for (let i = 1; i < parent.children.length; i++) {
        const a = parent.children[i - 1],
          b = parent.children[i];
        if (a.children.length || b.children.length) continue;
        const pa = translate(a.position, parent.position),
          pb = translate(b.position, parent.position);
        const span = (leaf: SyntaxNode, p: { x: number; y: number }) =>
          footprintSpan(
            [{ x: 0, y: 0, r: labelRadius(leaf), ...leafExtent(leaf) }],
            2 * Math.atanh(norm(p)),
          );
        const sa = span(a, pa),
          sb = span(b, pb);
        // Pills in disjoint radial bands may share angles; otherwise their arcs must not meet.
        if (sa.outer <= sb.inner || sb.outer <= sa.inner) continue;
        const gap = Math.abs(angleDelta(Math.atan2(pa.y, pa.x), Math.atan2(pb.y, pb.x)));
        assert.ok(gap >= sa.hi - sb.lo - 1e-6, `${a.text} overlaps ${b.text}`);
      }
  }
});

test("sibling reading arcs stay ordered, compact and outward across spacing settings", () => {
  const { root, nodes } = parse(
    "defn f (a b c)\n  combine x\n    nested p q r s t u v w\n    leaf y\n    final z",
  );
  for (const spacing of [0.45, 0.6, 0.85]) {
    layout(root, spacing);
    for (const parent of nodes.filter(
      (n) => n.parent && n.children.length > 1,
    )) {
      const back = translate(parent.parent!.position, parent.position);
      const heading = Math.atan2(back.y, back.x) + Math.PI;
      const angles = parent.children.map((child) => {
        const p = translate(child.position, parent.position);
        const angle = Math.atan2(p.y, p.x) - heading;
        return Math.atan2(Math.sin(angle), Math.cos(angle));
      });
      for (let i = 0; i < angles.length; i++) {
        assert.ok(
          Math.abs(angles[i]) < (2 * Math.PI) / 3 + 0.05,
          "descendants stay outside the incoming reading arc",
        );
        if (i === 0) continue;
        assert.ok(
          angles[i] > angles[i - 1],
          "syntax order must not reverse or double back",
        );
      }
    }
  }
});

test("reading rotation aligns forward siblings right and final backward sibling left", () => {
  const { nodes } = parse("defn f (a b c)\n  combine x y z\n  nested p q");
  for (const node of nodes) {
    const siblings = node.parent?.children;
    if (!siblings || siblings.length < 2) continue;
    const index = siblings.indexOf(node);
    const next = siblings[index + 1];
    const neighbor = next ?? siblings[index - 1];
    const p = translate(neighbor.position, node.position);
    const angle = readingRotation(node);
    const x = p.x * Math.cos(angle) - p.y * Math.sin(angle);
    const y = p.x * Math.sin(angle) + p.y * Math.cos(angle);
    if (!node.children.length) near(y, 0);
    assert.ok(next ? x > 0 : x < 0);
  }
  near(angleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2);
  near(angleDelta(-Math.PI + 0.1, Math.PI - 0.1), -0.2);
});

test("reading view puts parents above and first children below while siblings advance right", () => {
  const { nodes } = parse("defn f (a b c)\n  combine x y z\n  nested p q");
  for (const node of nodes) {
    const angle = readingRotation(node);
    const screenY = (other: SyntaxNode) => {
      const p = translate(other.position, node.position);
      return -(p.x * Math.sin(angle) + p.y * Math.cos(angle));
    };
    if (node.parent) assert.ok(screenY(node.parent) < 0);
    if (node.children.length) assert.ok(screenY(node.children[0]) > 0);
  }
  near(readingRotation(parse("").root, 0.7), 0.7);
});

test("branch orientation favors the first child below while retaining forward sibling direction", () => {
  const { nodes } = parse("defn f (a b c)\n  combine x y z\n  nested p q");
  for (const node of nodes.filter((n) => n.children.length > 1)) {
    const angle = readingRotation(node);
    const p = translate(node.children[0].position, node.position);
    const x = p.x * Math.cos(angle) - p.y * Math.sin(angle);
    const y = -(p.x * Math.sin(angle) + p.y * Math.cos(angle));
    assert.ok(
      y > 0 && Math.abs(x) < y * 0.5,
      "first child should sit close to the downward axis",
    );
  }
});

test("long tokens receive more room than short adjacent tokens", () => {
  const { root } = parse("f a extraordinarily-long-token z");
  const parent = root.children[0];
  layout(root, 0.5);
  const gap = (a: number, b: number) =>
    distance(parent.children[a].position, parent.children[b].position);
  assert.ok(gap(2, 3) > gap(0, 1));
});

test("first-child distance follows token width and stays reachable", () => {
  const firstEdge = (source: string, spacing: number) => {
    const { root } = parse(source);
    layout(root, spacing);
    const expression = root.children[0];
    return distance(expression.position, expression.children[0].position);
  };
  for (const spacing of [0.45, 0.6, 0.85]) {
    const single = firstEdge("x", spacing);
    const long = firstEdge("a-very-long-token", spacing);
    const nested = firstEdge("f (g a b c d e) (h a b c) z", spacing);
    assert.ok(single <= long, "short edges share a floor; longer tokens never sit closer");
    assert.ok(single < spacing, "a single leaf should sit close to its container");
    assert.ok(nested < 2.5, "large expressions still need reachable first children");
  }
});
test("single-expression chains stay compact and distinct", () => {
  for (const spacing of [0.45, 0.6, 0.85]) {
    const { root, nodes } = parse("((((x))))");
    layout(root, spacing);
    for (const node of nodes.filter((n) => n.children.length === 1)) {
      const gap = distance(node.position, node.children[0].position);
      assert.ok(
        gap > labelRadius(node, spacing) + labelRadius(node.children[0], spacing) &&
          gap < spacing,
        "compact chain must remain distinct and navigable",
      );
    }
  }
});
test("long leaf pairs get more separation and pass their width up to the expression", () => {
  const short = parse("pairs (a b) (c d) (e f)");
  const long = parse(
    "pairs (:truncated-octahedron-mirror truncatedOctahedronMirrorConfigs) (c d) (e f)",
  );
  const measurePair = (tree: ReturnType<typeof parse>) => {
    layout(tree.root, 0.5);
    const parent = tree.root.children[0];
    const pair = parent.children[1];
    return {
      gap: distance(pair.children[0].position, pair.children[1].position),
      // Clearance between the pair's tokens and the next sibling's subtree.
      sector: Math.min(
        ...pair.children.flatMap((token) =>
          [parent.children[2], ...parent.children[2].children].map((other) =>
            distance(token.position, other.position),
          ),
        ),
      ),
    };
  };
  const a = measurePair(short),
    b = measurePair(long);
  assert.ok(
    b.gap > a.gap * 1.2,
    "two long tokens need an absolute gap increase, not just relative weights",
  );
  assert.ok(
    b.sector >= a.sector * 0.99,
    "the long pair must not crowd its next sibling",
  );
});

test("junction optimization does not depend on stale positions from a previous layout", () => {
  const { root, nodes } = parse(examples["Soluble · 应用全景"]);
  layout(root, 0.5);
  const positions = nodes.map((node) => ({ ...node.position }));
  layout(root, 0.8);
  layout(root, 0.5);
  nodes.forEach((node, index) => {
    near(node.position.x, positions[index].x);
    near(node.position.y, positions[index].y);
  });
});
