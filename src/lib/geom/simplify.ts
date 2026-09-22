import type { Pt } from '../types';

/** Ramer-Douglas-Peucker, for thinning traced contours before extrusion. */
export function simplifyRing(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 4 || tol <= 0) return pts;
  // A closed ring has no natural endpoints, so anchor on the two points that
  // are furthest apart and simplify each half against them.
  let ai = 0;
  let bi = 0;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = dist2(pts[0], pts[i]);
    if (d > best) { best = d; bi = i; }
  }
  best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = dist2(pts[bi], pts[i]);
    if (d > best) { best = d; ai = i; }
  }
  if (ai > bi) { const t = ai; ai = bi; bi = t; }

  const first = pts.slice(ai, bi + 1);
  const second = pts.slice(bi).concat(pts.slice(0, ai + 1));
  const out = rdp(first, tol).slice(0, -1).concat(rdp(second, tol).slice(0, -1));
  return out.length >= 3 ? out : pts;
}

function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistance(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(rdp(pts.slice(idx), tol));
}

function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function dist2(a: Pt, b: Pt): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
