import * as polygonClippingNs from 'polygon-clipping';
import type { Pt } from '../types';
import { cleanRing, ensureWinding, type Region, type Ring } from './poly';

/**
 * Polygon boolean operations.
 *
 * Triangulation needs *simple* polygons — no edge crossing another. Several of
 * our inputs are not simple as they arrive:
 *
 *  - Font outlines legitimately overlap themselves. Fonts are filled with a
 *    nonzero-winding rule, so a designer can let the two strokes of a "V"
 *    overrun each other at the apex and it still renders correctly. Handing
 *    that straight to a triangulator gives undefined results; for Inter's "V"
 *    it covered 82% more area than the glyph occupies.
 *  - Two cutouts the user has dragged together overlap.
 *  - Traced artwork can produce touching regions.
 *
 * Resolving these with real boolean operations, rather than guarding against
 * them, means the geometry is correct in every case instead of merely refused
 * in the cases we anticipated.
 */

type PcRing = Array<[number, number]>;
type PcPoly = PcRing[];
type PcMulti = PcPoly[];

interface PcApi {
  union(geom: PcMulti, ...rest: PcMulti[]): PcMulti;
  difference(subject: PcMulti, ...clips: PcMulti[]): PcMulti;
  intersection(geom: PcMulti, ...rest: PcMulti[]): PcMulti;
}

/**
 * polygon-clipping disagrees with itself about how it is exported: the CommonJS
 * build has named exports, the ESM build has only a default, and the type
 * declarations describe the named ones. Node resolves the first, bundlers the
 * second, so take whichever actually arrived.
 */
const pc: PcApi = ((polygonClippingNs as unknown as { default?: PcApi }).default ??
  (polygonClippingNs as unknown as PcApi));

function toPc(region: Region): PcPoly {
  return [ringToPc(region.outer), ...region.holes.map(ringToPc)];
}

function ringToPc(r: Ring): PcRing {
  const c = cleanRing(r);
  return c.map((p) => [p.x, p.y] as [number, number]);
}

function fromPc(multi: PcMulti): Region[] {
  const out: Region[] = [];
  for (const poly of multi) {
    if (!poly.length) continue;
    const [outer, ...holes] = poly.map(pcToRing);
    if (outer.length < 3) continue;
    out.push({
      outer: ensureWinding(outer, true),
      holes: holes.filter((h) => h.length >= 3).map((h) => ensureWinding(h, false)),
    });
  }
  return out;
}

function pcToRing(r: PcRing): Ring {
  const pts: Ring = r.map(([x, y]) => ({ x, y } as Pt));
  // polygon-clipping returns closed rings; our convention is implicit closure.
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12) pts.pop();
  }
  return pts;
}

/**
 * Normalise a set of regions: resolve self-intersections and merge overlaps.
 *
 * A union with nothing else is the standard way to ask a boolean engine to
 * make a polygon valid.
 */
export function cleanRegions(regions: Region[]): Region[] {
  const usable = regions.filter((r) => r.outer.length >= 3);
  if (usable.length === 0) return [];
  try {
    return fromPc(pc.union(usable.map(toPc) as PcMulti));
  } catch {
    // Degrade to the unprocessed input rather than losing the geometry
    // outright; it may still triangulate acceptably.
    return usable;
  }
}

/** Regions of `base` with every region of `cutters` removed. */
export function subtractRegions(base: Region[], cutters: Region[]): Region[] {
  const usableBase = base.filter((r) => r.outer.length >= 3);
  if (usableBase.length === 0) return [];
  const usableCutters = cutters.filter((r) => r.outer.length >= 3);
  if (usableCutters.length === 0) return cleanRegions(usableBase);
  try {
    return fromPc(pc.difference(usableBase.map(toPc) as PcMulti, usableCutters.map(toPc) as PcMulti));
  } catch {
    return usableBase;
  }
}

/** The overlap between two sets of regions. */
export function intersectRegions(a: Region[], b: Region[]): Region[] {
  const ua = a.filter((r) => r.outer.length >= 3);
  const ub = b.filter((r) => r.outer.length >= 3);
  if (!ua.length || !ub.length) return [];
  try {
    return fromPc(pc.intersection(ua.map(toPc) as PcMulti, ub.map(toPc) as PcMulti));
  } catch {
    return [];
  }
}

/** Convenience: wrap loose rings as regions, nesting resolved by the engine. */
export function regionsFromRings(rings: Ring[]): Region[] {
  return cleanRegions(rings.map((r) => ({ outer: r, holes: [] })));
}
