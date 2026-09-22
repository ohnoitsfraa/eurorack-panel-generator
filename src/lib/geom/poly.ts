import type { Pt } from '../types';

export type Ring = Pt[];

/** A closed region: one outer ring plus any number of hole rings. */
export interface Region {
  outer: Ring;
  holes: Ring[];
}

/** Signed area. Positive means counter-clockwise in a y-up frame. */
export function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j].x - r[i].x) * (r[j].y + r[i].y);
  }
  return a / 2;
}

/**
 * Drop consecutive duplicate vertices.
 *
 * Curve flattening routinely emits repeated points — a quadratic whose control
 * point sits on an endpoint, or a contour that closes back onto its start. A
 * repeated point is a zero-length edge, which becomes a zero-area triangle
 * during triangulation; dropping those triangles then leaves their neighbours'
 * edges unpaired, so the mesh reads as non-manifold even though its shape is
 * correct. Cleaning the ring up front avoids creating them at all.
 */
export function cleanRing(r: Ring, eps = 1e-7): Ring {
  if (r.length < 3) return r;
  const out: Ring = [];
  for (const p of r) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) <= eps && Math.abs(prev.y - p.y) <= eps) continue;
    out.push(p);
  }
  // The closing wrap-around is a duplicate too.
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps) out.pop();
    else break;
  }
  return out.length >= 3 ? out : r;
}

export function ensureWinding(r: Ring, ccw: boolean): Ring {
  const isCcw = signedArea(r) > 0;
  return isCcw === ccw ? r : [...r].reverse();
}

export function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function bbox(rings: Ring[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Facet tolerance for circles, in mm.
 *
 * Holes are the functional part of a panel, so this is tighter than a purely
 * visual approximation would need. At 0.02 mm a 6 mm hole is a 28-sided
 * polygon bulging 0.04 mm at the vertices, comfortably inside what a printer
 * can resolve, for a few hundred extra triangles across a whole panel.
 */
export const CIRCLE_TOL_MM = 0.02;

/** Smallest segment count that keeps a circle's facet error under `tolMm`. */
export function segmentsForRadius(radiusMm: number, tolMm = 0.05): number {
  if (radiusMm <= tolMm) return 8;
  const n = Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - tolMm / radiusMm))));
  return Math.max(12, Math.min(160, n));
}

/**
 * A circle, as a polygon that encloses it rather than fits inside it.
 *
 * The obvious construction puts every vertex on the circle, which makes the
 * polygon slightly *smaller* than the circle everywhere between vertices — so
 * a 6 mm hole comes out at about 5.98 mm. For a hole that is the wrong
 * direction to be wrong in: a jack bushing that will not fit is a ruined
 * panel, while a hair of extra clearance is invisible behind the nut. Printers
 * also shrink holes as the plastic cools, so the two errors compound.
 *
 * Pushing the vertices out by 1/cos(pi/n) makes the flats tangent to the true
 * circle instead, so the hole measures at least its nominal size in every
 * direction.
 */
export function circleRing(cx: number, cy: number, d: number, tolMm = CIRCLE_TOL_MM): Ring {
  const r = d / 2;
  const n = segmentsForRadius(r, tolMm);
  const rOut = r / Math.cos(Math.PI / n);
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * rOut, y: cy + Math.sin(a) * rOut });
  }
  return out;
}

/**
 * A stadium: a rectangle of length `len` capped with semicircles of diameter
 * `width`. This is the shape of both a fader travel slot and an M3 mounting
 * slot, and the reason `len` is measured over the caps, not between them.
 */
export function slotRing(cx: number, cy: number, width: number, len: number, rotationDeg = 0): Ring {
  const r = width / 2;
  const straight = Math.max(0, len - width) / 2;
  const n = Math.max(8, Math.floor(segmentsForRadius(r) / 2));
  const pts: Ring = [];

  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI;
    pts.push({ x: straight + Math.cos(a) * r, y: Math.sin(a) * r });
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (i / n) * Math.PI;
    pts.push({ x: -straight + Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return rotateTranslate(pts, rotationDeg, cx, cy);
}

export function roundedRectRing(
  cx: number, cy: number, w: number, h: number, radius: number, rotationDeg = 0,
): Ring {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const hw = w / 2;
  const hh = h / 2;
  const pts: Ring = [];

  if (r <= 1e-6) {
    pts.push({ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh });
    return rotateTranslate(pts, rotationDeg, cx, cy);
  }

  const n = Math.max(4, Math.floor(segmentsForRadius(r) / 4));
  const corners: Array<[number, number, number]> = [
    [hw - r, hh - r, 0],
    [-(hw - r), hh - r, Math.PI / 2],
    [-(hw - r), -(hh - r), Math.PI],
    [hw - r, -(hh - r), (3 * Math.PI) / 2],
  ];
  for (const [ox, oy, start] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = start + (i / n) * (Math.PI / 2);
      pts.push({ x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r });
    }
  }
  return rotateTranslate(pts, rotationDeg, cx, cy);
}

export function rotateTranslate(pts: Ring, deg: number, tx: number, ty: number): Ring {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map((p) => ({ x: tx + p.x * c - p.y * s, y: ty + p.x * s + p.y * c }));
}

/**
 * Sort a flat set of even-odd rings into nested regions.
 *
 * Glyph outlines and traced artwork both arrive as an unordered pile of rings
 * where a letter "o" is two rings and an "8" is three. Depth by containment
 * tells us which is solid and which is a counter: even depth starts a new
 * region, odd depth is a hole in whatever encloses it.
 *
 * Containment is decided by testing a vertex of the inner ring against the
 * outer one. That works because these rings never cross, so a ring is either
 * wholly inside another or wholly outside, and one vertex settles it. Trying
 * instead to find a point "inside" a ring and testing that is a trap: for an
 * "O" the natural candidate is its centre, which sits in the counter, so the
 * glyph would count as contained by its own hole.
 */
export function nestRings(rings: Ring[]): Region[] {
  const valid = rings
    .map((r) => cleanRing(r))
    .filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-9);
  const n = valid.length;
  if (n === 0) return [];

  const inside: boolean[][] = valid.map(() => new Array(n).fill(false));
  const depth = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (ringInsideRing(valid[i], valid[j])) {
        inside[i][j] = true;
        depth[i]++;
      }
    }
  }

  const area = valid.map((r) => Math.abs(signedArea(r)));
  const regions: Region[] = [];
  const regionByIndex = new Map<number, Region>();

  // Shallow rings first, so a hole's parent region already exists.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => depth[a] - depth[b]);

  for (const i of order) {
    if (depth[i] % 2 === 0) {
      const region: Region = { outer: ensureWinding(valid[i], true), holes: [] };
      regions.push(region);
      regionByIndex.set(i, region);
      continue;
    }

    // The immediate parent is the smallest solid ring that contains this one.
    let parent = -1;
    for (let j = 0; j < n; j++) {
      if (!inside[i][j] || depth[j] !== depth[i] - 1) continue;
      if (parent === -1 || area[j] < area[parent]) parent = j;
    }
    const region = parent === -1 ? undefined : regionByIndex.get(parent);
    if (region) {
      region.holes.push(ensureWinding(valid[i], false));
    } else {
      // No enclosing region found, which should not happen for well-formed
      // outlines. Keeping it as its own solid loses less than dropping it.
      regions.push({ outer: ensureWinding(valid[i], true), holes: [] });
    }
  }
  return regions;
}

/**
 * Is ring `inner` contained by ring `outer`?
 *
 * Sampled over several vertices and decided by majority, so a single vertex
 * that happens to land on the other ring's edge cannot flip the answer.
 */
function ringInsideRing(inner: Ring, outer: Ring): boolean {
  const samples = Math.min(5, inner.length);
  let hits = 0;
  for (let k = 0; k < samples; k++) {
    const p = inner[Math.floor((k * inner.length) / samples)];
    if (pointInRing(p, outer)) hits++;
  }
  return hits * 2 > samples;
}

/** Do two closed rings share any area, or cross each other? */
export function ringsOverlap(a: Ring, b: Ring): boolean {
  const ba = bbox([a]);
  const bb = bbox([b]);
  if (ba.x1 < bb.x0 || ba.x0 > bb.x1 || ba.y1 < bb.y0 || ba.y0 > bb.y1) return false;

  // Containment either way. Covers one ring swallowing the other, where no
  // edges cross at all.
  if (pointInRing(a[0], b) || pointInRing(b[0], a)) return true;

  // Crossing edges. Needed for shapes that overlap without either's vertices
  // landing inside the other, such as two bars meeting in a plus sign.
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    for (let k = 0, l = b.length - 1; k < b.length; l = k++) {
      if (segmentsIntersect(a[j], a[i], b[l], b[k])) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false; // parallel or collinear
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
