import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FrameScheduler,
  geodesicArc,
  readableLabel,
  leafLabelAngle,
  containsRotatedBox,
  LabelGrid,
} from "./render-utils.ts";
import { geodesic, norm } from "./core.ts";

function harness(paint: (time: number) => boolean) {
  let serial = 0;
  const callbacks = new Map<number, (time: number) => void>();
  const scheduler = new FrameScheduler(
    paint,
    (callback) => {
      callbacks.set(++serial, callback);
      return serial;
    },
    (id) => {
      callbacks.delete(id);
    },
  );
  return {
    scheduler,
    callbacks,
    tick: (time = 0) => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(time));
    },
  };
}
test("idle has zero frames; many invalidations coalesce; settled animation stops", () => {
  let draws = 0;
  const h = harness(() => ++draws < 3);
  assert.equal(h.callbacks.size, 0);
  for (let i = 0; i < 100; i++) h.scheduler.invalidate();
  assert.equal(h.callbacks.size, 1);
  h.tick();
  h.tick();
  h.tick();
  assert.equal(draws, 3);
  assert.equal(h.callbacks.size, 0);
  h.tick();
  assert.equal(draws, 3);
});
test("hidden tab cancels animation and coalesces dirty work until visible", () => {
  let draws = 0;
  const h = harness(() => {
    draws++;
    return false;
  });
  h.scheduler.invalidate();
  h.scheduler.setVisible(false);
  assert.equal(h.callbacks.size, 0);
  for (let i = 0; i < 10; i++) h.scheduler.invalidate();
  h.tick();
  assert.equal(draws, 0);
  h.scheduler.setVisible(true);
  h.tick();
  assert.equal(draws, 1);
  assert.equal(h.callbacks.size, 0);
  h.scheduler.setVisible(false);
  h.scheduler.setVisible(true);
  assert.equal(h.callbacks.size, 0);
});
test("batched circle arcs match disk geodesics and select the interior arc", () => {
  assert.equal(geodesicArc({ x: 0, y: 0 }, { x: 0.6, y: 0.3 }), null);
  for (let i = 1; i <= 100; i++) {
    const a = { x: 0.92 * Math.cos(i * 0.7), y: 0.92 * Math.sin(i * 0.7) };
    const b = { x: 0.81 * Math.cos(i * 2.3), y: 0.81 * Math.sin(i * 2.3) };
    const arc = geodesicArc(a, b)!;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = geodesic(a, b, t);
      assert.ok(
        Math.abs(Math.hypot(p.x - arc.x, p.y - arc.y) - arc.radius) < 1e-7,
      );
    }
    const midAngle = (arc.start + arc.end) / 2;
    assert.ok(
      norm({
        x: arc.x + arc.radius * Math.cos(midAngle),
        y: arc.y + arc.radius * Math.sin(midAngle),
      }) < 1,
    );
  }
});
test("tiny label culling follows screen footprint, with focus always readable", () => {
  assert.equal(readableLabel(0.02, 400, true, false), false);
  assert.equal(readableLabel(0.03, 200, true, false), false);
  assert.equal(readableLabel(0.1, 400, true, false), true);
  assert.equal(readableLabel(0.1, 400, false, false), true);
  assert.equal(readableLabel(0, 1, false, true), true);
  assert.equal(readableLabel(0.09, 400, false, false, true), true);
  assert.equal(readableLabel(0.02, 400, false, false, true), false);
});
test("label spatial grid catches collisions across cell boundaries", () => {
  const grid = new LabelGrid();
  assert.ok(grid.reserve({ x: 63, y: 63, w: 60, h: 20 }));
  assert.equal(grid.reserve({ x: 92, y: 66, w: 50, h: 20 }), false);
  assert.ok(grid.reserve({ x: 190, y: 66, w: 50, h: 20 }));
  assert.equal(grid.reserve({ x: 150, y: 68, w: 50, h: 20 }), false);
});

test("nearby leaf text stays horizontal and far text follows the path without flipping upside down", () => {
  assert.equal(leafLabelAngle(1, 2, 0.2), 0);
  assert.ok(leafLabelAngle(1, 2, 0.85) > leafLabelAngle(1, 2, 0.5));
  assert.ok(Math.abs(leafLabelAngle(-1, 2, 0.9)) <= 1.15);
  assert.equal(leafLabelAngle(1, 0, 0.9), 0);
});
test("tilted token hit targets track the actual text rather than its bounding rectangle", () => {
  const box = { x: 100, y: 100, w: 100, h: 20, angle: Math.PI / 4 };
  assert.ok(containsRotatedBox(box, 130, 130));
  assert.equal(containsRotatedBox(box, 130, 70), false);
  assert.ok(containsRotatedBox(box, 100, 100));
});
