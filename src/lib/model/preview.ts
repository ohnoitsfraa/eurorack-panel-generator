import type { DecorElement } from '../types';
import { circleRing, roundedRectRing, rotateTranslate, segmentsForRadius, slotRing, type Ring } from '../geom/poly';
import { cleanRegions } from '../geom/boolean';

type Shape = Extract<DecorElement, { type: 'shape' }>;

/**
 * Ring geometry for a shape element.
 *
 * Shared by the 2D editor and the mesh builder so that what is drawn and what
 * is printed cannot drift apart.
 */
export function shapeRingsForPreview(el: Shape): Ring[] {
  if (el.shape === 'circle') return [circleRing(el.x, el.y, Math.min(el.w, el.h))];
  if (el.shape === 'line' && el.bend && Math.abs(el.bend.y * el.w) > 1e-3) return bentLineRings(el, el.bend);
  const radius = el.shape === 'line' ? Math.min(el.w, el.h) / 2 : el.radius;
  return [roundedRectRing(el.x, el.y, el.w, el.h, radius, el.rotation)];
}

/**
 * A line bent through its handle, in its own frame and then set in place.
 *
 * Its ends stay where the straight line's were, and are rounded as a straight
 * line's are. Bent at a corner, it is two straight lines meeting at the
 * handle, with the corner rounded over the same as the ends. Curved, the
 * handle is the top of the curve, wherever along the line it is pulled to;
 * see `curveCourse`. Either is drawn as a band the line's thickness wide.
 */
function bentLineRings(el: Shape, bend: NonNullable<Shape['bend']>): Ring[] {
  const c = el.w / 2;
  const t = el.h / 2;
  const px = bend.x * el.w;
  const py = bend.y * el.w;
  const place = (r: Ring) => rotateTranslate(r, el.rotation, el.x, el.y);

  if (bend.corner) {
    const leg = (ax: number, ay: number) => {
      const len = Math.hypot(px - ax, py - ay);
      const angle = (Math.atan2(py - ay, px - ax) * 180) / Math.PI;
      return slotRing((ax + px) / 2, (ay + py) / 2, el.h, len + el.h, angle);
    };
    return outlines([place(leg(-c, 0)), place(leg(c, 0))]);
  }

  // Out along one side, a round cap, back along the other, a round cap.
  const course = curveCourse(c, px, py, t);
  const m = Math.max(6, Math.floor(segmentsForRadius(t) / 2));
  const cap = (p: CoursePoint, sign: 1 | -1): Ring => {
    const pts: Ring = [];
    for (let i = 1; i < m; i++) {
      const f = (Math.PI * i) / m;
      pts.push({
        x: p.x + sign * t * (p.ox * Math.cos(f) + p.tx * Math.sin(f)),
        y: p.y + sign * t * (p.oy * Math.cos(f) + p.ty * Math.sin(f)),
      });
    }
    return pts;
  };
  const ring: Ring = [
    ...course.map((p) => ({ x: p.x + p.ox * t, y: p.y + p.oy * t })),
    ...cap(course[course.length - 1], 1),
    ...course.slice().reverse().map((p) => ({ x: p.x - p.ox * t, y: p.y - p.oy * t })),
    ...cap(course[0], -1),
  ];
  // A thick line bent tight, or nearly round, overlaps itself; the union
  // makes that one clean outline.
  return outlines([place(ring)]);
}

interface CoursePoint {
  x: number; y: number;
  /** The way the line runs here, from its first end to its second. */
  tx: number; ty: number;
  /** Square to it, out of the bend. */
  ox: number; oy: number;
}

/**
 * The course of a curved line from (-c, 0) to (c, 0), peaking at its handle
 * (px, py).
 *
 * Two arcs, one from each end, meeting at the handle running level with the
 * line, so the curve has no kink there and the handle is its highest point.
 * Each has its centre straight across the line from the handle. With the
 * handle in the middle the two are halves of one circle, and the line is a
 * true arc; pulled to one side, the bend leans that way.
 */
function curveCourse(c: number, px: number, py: number, t = 0): CoursePoint[] {
  // Turning the way that has the line running from the first end to the
  // second as it passes the handle.
  const dir = -Math.sign(py);
  const turn = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const out: CoursePoint[] = [];
  const half = (span: number, toHandle: boolean) => {
    const R = (span * span + py * py) / (2 * py);
    const ox = px, oy = py - R;
    const r = Math.abs(R);
    const aTop = Math.atan2(R, 0);
    const aEnd = Math.atan2(-oy, (toHandle ? -c : c) - ox);
    const [from, to] = toHandle ? [aEnd, aTop] : [aTop, aEnd];
    const sweep = dir > 0 ? turn(to - from) : -turn(from - to);
    const n = Math.max(4, Math.ceil((segmentsForRadius(r + t) * Math.abs(sweep)) / (2 * Math.PI)));
    for (let i = toHandle ? 0 : 1; i <= n; i++) {
      const a = from + (sweep * i) / n;
      const cos = Math.cos(a), sin = Math.sin(a);
      out.push({ x: ox + cos * r, y: oy + sin * r, tx: -dir * sin, ty: dir * cos, ox: cos, oy: sin });
    }
  };
  half(c + px, true);
  half(c - px, false);
  return out;
}

/**
 * A point on a line's course, `t` of the way from its first end to its
 * second, with the unit normal there that points out of the bend: the side
 * there is room for a handle. A straight line's normal is its own +y.
 */
export function pointAlongLine(
  el: Shape, t: number,
): { x: number; y: number; nx: number; ny: number } {
  const c = el.w / 2;
  const px = (el.bend?.x ?? 0) * el.w;
  const py = (el.bend?.y ?? 0) * el.w;
  let local: { x: number; y: number; nx: number; ny: number };
  if (!el.bend || Math.abs(py) <= 1e-3) {
    local = { x: -c + t * el.w, y: 0, nx: 0, ny: 1 };
  } else if (el.bend.corner) {
    const [ax, s] = t < 0.5 ? [-c, t * 2] : [c, (1 - t) * 2];
    const len = Math.hypot(px - ax, py) || 1;
    // Square to the leg, on the side the corner sticks out to.
    const flip = (px - ax) * Math.sign(py) >= 0 ? 1 : -1;
    local = { x: ax + (px - ax) * s, y: py * s, nx: (-py / len) * flip, ny: ((px - ax) / len) * flip };
  } else {
    // Measured along the curve, so three quarters is three quarters of its length.
    const course = curveCourse(c, px, py);
    const lengths = [0];
    for (let i = 1; i < course.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(course[i].x - course[i - 1].x, course[i].y - course[i - 1].y));
    }
    const want = t * lengths[lengths.length - 1];
    let i = 1;
    while (i < course.length - 1 && lengths[i] < want) i++;
    const f = (want - lengths[i - 1]) / ((lengths[i] - lengths[i - 1]) || 1);
    const p = course[i - 1], q = course[i];
    const nx = p.ox + (q.ox - p.ox) * f, ny = p.oy + (q.oy - p.oy) * f;
    const nl = Math.hypot(nx, ny) || 1;
    local = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, nx: nx / nl, ny: ny / nl };
  }
  const a = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return {
    x: el.x + local.x * cos - local.y * sin,
    y: el.y + local.x * sin + local.y * cos,
    nx: local.nx * cos - local.ny * sin,
    ny: local.nx * sin + local.ny * cos,
  };
}

function outlines(rings: Ring[]): Ring[] {
  return cleanRegions(rings.map((outer) => ({ outer, holes: [] }))).flatMap((r) => [r.outer, ...r.holes]);
}
