import { CUTOUT_PRESETS, type CutoutShapeId } from './eurorack';

/**
 * A cutout drawn by dragging, from where the press started to where the
 * pointer is now.
 *
 * Corner to corner, as boxes are drawn everywhere else; from the centre out
 * with Alt, which is the quicker way to size a hole around a spot already
 * marked. A circle has one size, so it takes the longer side of the drag and
 * grows from the corner it started in. Shift makes a rectangle square.
 *
 * Returns null for a drag too short to mean a size: that was a click, and a
 * click places the shape at its usual size.
 */
export function drawnCutout(
  shape: CutoutShapeId,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { square?: boolean; fromCentre?: boolean; minDragMm?: number } = {},
): { x: number; y: number; w: number; h: number } | null {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < (opts.minDragMm ?? 1)) return null;

  const circle = (CUTOUT_PRESETS.find((p) => p.id === shape)?.shape ?? 'circle') === 'circle';
  if (circle || opts.square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * s;
    dy = (dy < 0 ? -1 : 1) * s;
  }
  // Nothing thinner than a printer can open up.
  const w = Math.max(MIN_SIDE_MM, Math.abs(dx) * (opts.fromCentre ? 2 : 1));
  const h = Math.max(MIN_SIDE_MM, Math.abs(dy) * (opts.fromCentre ? 2 : 1));
  const x = opts.fromCentre ? from.x : from.x + dx / 2;
  const y = opts.fromCentre ? from.y : from.y + dy / 2;
  return { x: round2(x), y: round2(y), w: round2(w), h: round2(h) };
}

const MIN_SIDE_MM = 0.5;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * A line drawn by dragging from one end to the other.
 *
 * Shift holds it to 15° steps, which takes in level, plumb and the 45°s, the
 * angles panel lines are nearly always drawn at. Null for a drag too short to
 * be a line: a click, which lays down the usual rule instead.
 */
export function drawnLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { snapAngle?: boolean; minDragMm?: number } = {},
): { from: { x: number; y: number }; to: { x: number; y: number }; length: number; angle: number } | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < (opts.minDragMm ?? 1)) return null;
  let angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  if (opts.snapAngle) angle = Math.round(angle / 15) * 15;
  const a = (angle * Math.PI) / 180;
  const end = { x: round2(from.x + Math.cos(a) * length), y: round2(from.y + Math.sin(a) * length) };
  return { from, to: end, length: round2(length), angle: Math.round(angle * 100) / 100 };
}
