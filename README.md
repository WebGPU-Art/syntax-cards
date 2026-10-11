# Syntax Atlas

A full-viewport TypeScript + Canvas 2D reader for Calcit / Cirru syntax trees in the Poincaré disk. No Calcit compiler or GPU dependency is required.

```sh
corepack enable
yarn install --immutable
yarn dev
```

`yarn check` checks TypeScript, `yarn test` checks parsing, repository excerpts and geometry, and `yarn build` produces `dist/`. Node 22+ is recommended.

## Real repository examples

The default **Soluble · 应用全景** combines nine complete definitions from the sibling `soluble/calcit.cirru`: `comp-container`, `comp-nav`, `main!`, `get-app`, `load-textures!`, `handle-gamepad!`, `reload!`, `render-app!`, and `updater`. It contains **1,050 syntax nodes, 221 excerpt lines and 27 AST levels**, including comments represented by the Cirru reader. These are source syntax trees, not macro-expanded compiler IR.

Three focused excerpts are also included:

| Example | Nodes | Excerpt lines |
| --- | ---: | ---: |
| Navigation components | 251 | 45 |
| Async initialization and lifecycle | 526 | 95 |
| Renderer dispatch and updater | 243 | 70 |

`scripts/extract-examples.mjs` reads the original snapshot without modifying it, removes only the enclosing `:code $ quote $` wrapper and common indentation, and saves function names and original line ranges alongside the exact bodies in `src/repository-examples.json`. Run `yarn examples:refresh` when the sibling project is available to refresh the fixtures. The checked-in fixtures work independently of that repository. The source overlay shows the provenance. Three smaller tutorial programs remain available.

## Interaction

- The disk fills the viewport; source and inspector panels are floating overlays, closed initially.
- Click a node, source line, breadcrumb, or inspector child to move that node to the center.
- `↑` goes to the parent; `↓` enters the first child in expression order (including leaf tokens). `←` / `→` visit previous/next siblings in expression order, independent of screen position. At either end, further presses stay on the current node without wrapping or redrawing. `Home` returns to the root.
- `F` or the focus button hides overlays, leaving a small exit button and current-node identifier. `Escape` exits focus mode; outside focus mode it returns to the root. Opening focus mode preserves panel state and editor drafts.
- The spacing slider adjusts the initial embedding while keeping the selected node centered. Smaller spacing exposes more levels. The camera itself never re-layouts the tree during navigation.
- The disk center sits at 44% of viewport width and 43% of viewport height, reserving more space to the right and below the focus. The default view is 1.25×, letting the disk extend beyond the shorter viewport dimension. Wheel or the view slider adjusts magnification from 1× to 2×. This is screen magnification, not a change to hyperbolic curvature; the outer disk can extend offscreen. Browser Ctrl/Cmd zoom shortcuts remain available.
- The editor uses the official `@cirru/parser.ts` reader, including indentation groups, `$`, parentheses, comma folding and quoted tokens. Invalid input leaves the previous tree intact. No code or asset URL in the input is executed or fetched.

Limits: 80,000 characters, 4,000 nodes, 32 AST levels. Reduced-motion preferences skip camera transitions. On narrow screens, opening one panel closes the other.

## Layout and rendering

Children are placed in their parent's local disk frame, pointing away from its own parent. Children follow compact arcs rather than full radial fans: expression arcs expand up to 2.85 radians for wide sibling groups, with a wider 5.15-radian module overview. Leaf weights estimate token width (up to 16 displayed Unicode code points). A separate row-width estimate includes the label padding: long leaf pairs widen their local arc and modestly increase their separation even when both tokens have equal weights. Expression weights combine square-root subtree ink, direct branch count, logarithmic depth, and direct leaf width, passing the row footprint up to the parent. Weights to the power 0.65 allocate angular sectors without allowing a large subtree to dominate. Each junction evaluates 25 candidate turns (plus the original orientation), up to ±60°, against the actual previous/next sibling bearings. Neighbor row width and child footprint penalize cramped angles, with extra clearance for the first-child connector. Fans remain outward and ordered but can be strongly asymmetric. All sibling positions are assigned before descending, so results are deterministic and independent of prior layout state. This search runs only when laying out a program or changing spacing. Local edge length combines sibling count, average immediate label/branch footprint and a weaker logarithmic subtree-ink term. Any single-child expression uses a compact step: leaves retain a width-sensitive gap, while a sole expression gets a short connector with modest extra space before a broad subtree. Consecutive single-child chains keep a minimum gap so their circles remain distinct. A bounded breadth allowance and a 2.25-unit nominal cap keep larger expressions reachable. Within each sibling group, the first child uses 52% of the nominal step and the last 94%, increasing with normalized index to the power 0.75 before deep-path compression. Adjacent siblings (without a last-to-first wrap) are connected by muted purple geodesics; only the parent-to-first-child link is drawn, using a distinct saturated teal. Links to all subsequent children are omitted; purple sibling chains carry their order. The active first-child link is brighter and slightly thicker. Sibling topology and ordinal positions are cached per program. Inspired by the continuous sibling paths in [Hovenia Editor](https://github.com/Cirru/hovenia-editor), continuous purple links indicate syntax order; the selected node’s sibling chain (the root’s children at the root) is highlighted. Canvas nodes have no ordinal labels or direction arrows. This keeps parent-child distances bounded even at deeply nested nodes. The accumulated path length is smoothly compressed toward 19 hyperbolic units to retain floating-point precision near the unit boundary. This reduces spacing progressively on deep paths without limiting spacing changes near the root.

The camera uses the disk isometry `T_a(z) = (z-a)/(1-conj(a)z)`. Its center follows a geodesic with eased hyperbolic distance. A simultaneous shortest-turn rotation aligns leaf siblings horizontally. Branches bias the first child toward the downward axis, with a bounded turn that keeps the next sibling in the right half of the view; at the end of a group the previous sibling stays left. The projected disk is reflected vertically so parents appear above and children descend while sibling order still runs rightward. Root views align the first child downward; single-child chains orient vertically. Interrupted transitions start at the current camera position and rotation. Edges use native circle arcs orthogonal to the disk boundary; arcs with subpixel sagitta use straight segments. Nodes with a useful projected footprint remain as dots when their labels are hidden; subpixel nodes are omitted from rasterization but remain in the tree and inspector.

Following the leaf/container distinction of [Cirru / Calcit Editor](https://github.com/Cirru/calcit-editor), each leaf displays only its own token (at most 16 Unicode code points including the ellipsis, with a 160px card width limit). Leaves use blue rounded text pills; expressions use small green circles inspired by Hovenia’s branch ports, without a preview of their children. Expression circles are 4–10px across depending on projected scale, with a minimum 16px hit target. Selection uses contrasting fill, text and stroke colors without changing node dimensions, font size or weight. Distant nodes shrink to colored dots. Hover shows the full token or a complete parenthesized representation of the expression in a scrollable tooltip. Tooltip content is computed only when the hovered node changes; hovering does not redraw the canvas. Breadcrumbs and the inspector keep descriptive previews for navigation.

Leaf labels remain horizontal within 32% of the disk radius, then smoothly follow the sibling-path tangent toward the edge, capped at 66° and kept upright. Hit testing and hover outlines use the same rotation. Labels are a readable screen overlay on the geometry: the local disk metric affects their size, with a minimum readable font, rather than an exact geometric warp. Nodes within four AST edges of the focus (parents and descendants included) receive priority and retain their content outside the tiny edge band. All circles and leaf labels stay on their true node positions, without label offsets or auxiliary leader lines. Four-hop content may overlap; the selected node is painted last to remain legible. Distant labels use collision filtering. Other interior nodes also use a much narrower edge-only LOD band; exceptionally dense distant labels may still exhaust available screen space. The HUD reports total nodes and currently drawn labels (some may be covered by UI overlays). Labels can change during movement as screen space becomes available. Dense distant branches still require navigation; the inspector exposes every child in source order.

Geometry reference: [Hitchman, The Poincaré Disk Model](https://mphitchman.com/geometry/section5-1.html).

## Rendering performance

Rendering is invalidation-driven. A frame scheduler coalesces requests, continues only while the camera is moving, and cancels pending work while the page is hidden. Selecting the current focus or setting an unchanged zoom/spacing does not redraw. Opening overlays and moving the pointer do not invalidate the tree: hover highlighting and tooltips are separate DOM overlays.

The disk background and tick marks are raster-cached until size, device scale or zoom changes. Each node is projected once per scene frame. Parent-to-first-child edges use two emphasis batches, sibling edges two emphasis batches, and dots three color batches rather than issuing a stroke/fill per item. Geodesic arcs replace the former per-edge interpolation loops.

Label LOD is checked before sorting, truncation and measurement. Labels outside the four-hop neighborhood need at least 20 CSS pixels of local projected scale (metric factor 0.1); neighborhood labels need 14 pixels (factor 0.08). Both tokens and containers use these edge thresholds. The selected label remains readable. Only surviving candidates are sorted. Integer font sizes permit a bounded text-width cache, cleared for a new program; label collision queries use a screen-space grid. HUD updates are throttled during animation, and accessibility text is updated after settling.

For read-only verification, the canvas publishes `data-render-count`, `data-label-candidates`, and `data-text-cache-size` after a render settles. These have no polling timer. The render count should stay unchanged while idle, while hovering, and when opening/closing overlays. Animation frames contribute to the next settled count. No fixed FPS guarantee is assumed across devices.

## Files and verification

- `src/core.ts`: official reader adapter, AST source locations, local layout and disk geometry.
- `src/main.ts`: Canvas rendering, label collision filtering, camera and floating UI.
- `src/style.css`: full-screen HUD and focus mode.
- `src/repository-examples.json`: reproducible, attributed Calcit source excerpts.
- `src/render-utils.ts`: frame scheduler, exact arc construction, label LOD and collision grid.
- `src/render-utils.test.ts`: idle/coalescing/hidden-page behavior, arc geometry and label filtering regressions.
- `src/core.test.ts`: isometries, geodesic interpolation, syntax fidelity, source extraction and deep-navigation regression tests. Original-file comparison runs when the sibling source is present; all checked-in fixture ASTs are checked in CI.

## Deployment

CI validates TypeScript and tests before building. PRs build without production credentials or uploads. Main retains the existing COS and rsync destinations. `VITE_BASE_URL` configures the asset base. Deployment requires `COS_BUCKET`, `COS_SECRET_ID`, `COS_SECRET_KEY`, and `rsync_private_key` secrets.

MIT


## Layout experiments

Run `node --import tsx scripts/compare-layouts.ts` to compare compact, balanced and spacious parameter sets on 15 fixed views of the 1,050-node repository example. The rough geometric crowding estimate counts node pairs whose distance is less than an estimated token footprint; it is not a screenshot-overlap or performance benchmark. Compact / balanced / spacious produced 153 / 94 / 72 close pairs per 100 visible nodes, with mean visible counts 255 / 198 / 145 inside radius 0.9. The balanced preset is the default compromise. Camera motion does not re-layout the tree or rerun subtree weight computation.
