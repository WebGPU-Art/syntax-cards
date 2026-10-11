import type { Point } from "./core";

/** Coalesce invalidations; a settled or hidden scene has no pending frame. */
export class FrameScheduler {
  private frame: number | undefined;
  private dirty = false;
  private visible = true;
  constructor(
    private paint: (time: number) => boolean,
    private request: (callback: (time: number) => void) => number,
    private cancel: (id: number) => void,
  ) {}
  invalidate() {
    this.dirty = true;
    if (!this.visible || this.frame !== undefined) return;
    this.frame = this.request((time) => {
      this.frame = undefined;
      this.dirty = false;
      if (this.paint(time)) this.invalidate();
    });
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible && this.frame !== undefined) {
      this.cancel(this.frame);
      this.frame = undefined;
      this.dirty = true;
    } else if (visible && this.dirty) this.invalidate();
  }
}

/** Orthogonal-circle representation of a disk geodesic (null means diameter). */
export function geodesicArc(a: Point, b: Point) {
  const det = a.x * b.y - a.y * b.x;
  if (Math.abs(det) < 1e-9) return null;
  const u = (1 + a.x * a.x + a.y * a.y) / 2;
  const v = (1 + b.x * b.x + b.y * b.y) / 2;
  const x = (u * b.y - v * a.y) / det;
  const y = (a.x * v - b.x * u) / det;
  const radius = Math.hypot(a.x - x, a.y - y);
  const start = Math.atan2(a.y - y, a.x - x);
  let sweep = Math.atan2(b.y - y, b.x - x) - start;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  return { x, y, radius, start, end: start + sweep, anticlockwise: sweep < 0 };
}

/** Cull before sorting, string creation or measureText, using CSS pixel footprint. */
export function readableLabel(
  metric: number,
  radius: number,
  _expression: boolean,
  selected: boolean,
  nearby = false,
) {
  return (
    selected ||
    (metric >= (nearby ? 0.08 : 0.1) && metric * radius >= (nearby ? 14 : 20))
  );
}

export type Box = { x: number; y: number; w: number; h: number };
export class LabelGrid {
  private cells = new Map<string, Box[]>();
  private keys(box: Box) {
    const keys: string[] = [];
    for (
      let x = Math.floor((box.x - box.w / 2 - 3) / 64);
      x <= Math.floor((box.x + box.w / 2 + 3) / 64);
      x++
    )
      for (
        let y = Math.floor((box.y - box.h / 2 - 3) / 64);
        y <= Math.floor((box.y + box.h / 2 + 3) / 64);
        y++
      )
        keys.push(`${x}:${y}`);
    return keys;
  }
  reserve(box: Box, force = false) {
    const keys = this.keys(box);
    if (
      !force &&
      keys.some((key) =>
        this.cells
          .get(key)
          ?.some(
            (other) =>
              Math.abs(box.x - other.x) < (box.w + other.w) / 2 + 5 &&
              Math.abs(box.y - other.y) < (box.h + other.h) / 2 + 4,
          ),
      )
    )
      return false;
    for (const key of keys) {
      const cell = this.cells.get(key);
      if (cell) cell.push(box);
      else this.cells.set(key, [box]);
    }
    return true;
  }
}

/** Flatten near the camera; let distant tokens follow their ordered sibling tangent. */
export function leafLabelAngle(
  dx: number,
  dy: number,
  radialDistance: number,
): number {
  let tangent = Math.atan2(dy, dx);
  if (tangent > Math.PI / 2) tangent -= Math.PI;
  if (tangent < -Math.PI / 2) tangent += Math.PI;
  const t = Math.max(0, Math.min(1, (radialDistance - 0.32) / 0.48));
  return Math.max(-1.15, Math.min(1.15, tangent)) * t * t * (3 - 2 * t);
}
export function containsRotatedBox(
  box: Box & { angle?: number },
  x: number,
  y: number,
): boolean {
  const angle = box.angle ?? 0,
    dx = x - box.x,
    dy = y - box.y;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(localX) <= box.w / 2 && Math.abs(localY) <= box.h / 2;
}
