import type { Pt } from '../types';
import { simplifyRing } from './simplify';

/**
 * Marching squares: binary bitmap -> closed contour rings.
 *
 * Used to turn an uploaded logo or picture into printable relief.
 * Each cell of the mask contributes zero, one or two directed segments; the
 * segments are then stitched end-to-end into rings. Because every segment is
 * directed with the filled side on a consistent hand, stitching never has to
 * guess which way to go.
 */

type Seg = { ax: number; ay: number; bx: number; by: number };

/** Edge midpoints of the cell whose top-left corner is (x, y). */
function T(x: number, y: number): [number, number] { return [x + 0.5, y]; }
function R(x: number, y: number): [number, number] { return [x + 1, y + 0.5]; }
function B(x: number, y: number): [number, number] { return [x + 0.5, y + 1]; }
function L(x: number, y: number): [number, number] { return [x, y + 0.5]; }

export function traceContours(
  mask: Uint8Array,
  width: number,
  height: number,
  simplifyTol = 0.75,
): Pt[][] {
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x];

  const segs: Seg[] = [];
  const push = (a: [number, number], b: [number, number]) =>
    segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });

  // Iterate one cell beyond each edge so shapes touching the border still close.
  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const idx = tl * 8 + tr * 4 + br * 2 + bl;
      if (idx === 0 || idx === 15) continue;

      switch (idx) {
        case 1: push(L(x, y), B(x, y)); break;
        case 2: push(B(x, y), R(x, y)); break;
        case 3: push(L(x, y), R(x, y)); break;
        case 4: push(R(x, y), T(x, y)); break;
        case 6: push(B(x, y), T(x, y)); break;
        case 7: push(L(x, y), T(x, y)); break;
        case 8: push(T(x, y), L(x, y)); break;
        case 9: push(T(x, y), B(x, y)); break;
        case 11: push(T(x, y), R(x, y)); break;
        case 12: push(R(x, y), L(x, y)); break;
        case 13: push(R(x, y), B(x, y)); break;
        case 14: push(B(x, y), L(x, y)); break;
        // Saddles: two filled corners meeting only at a diagonal. Resolve by
        // treating the centre as filled, which joins them rather than pinching
        // the contour to a point that stitching cannot pass through.
        case 5: push(L(x, y), T(x, y)); push(R(x, y), B(x, y)); break;
        case 10: push(T(x, y), R(x, y)); push(B(x, y), L(x, y)); break;
      }
    }
  }

  return stitch(segs).map((r) => simplifyRing(r, simplifyTol)).filter((r) => r.length >= 3);
}

/** Join directed segments head-to-tail into closed rings. */
function stitch(segs: Seg[]): Pt[][] {
  const key = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const byStart = new Map<string, Seg[]>();
  for (const s of segs) {
    const k = key(s.ax, s.ay);
    const list = byStart.get(k);
    if (list) list.push(s); else byStart.set(k, [s]);
  }

  const used = new Set<Seg>();
  const rings: Pt[][] = [];

  for (const seed of segs) {
    if (used.has(seed)) continue;
    const ring: Pt[] = [];
    let cur: Seg | undefined = seed;
    const startKey = key(seed.ax, seed.ay);

    while (cur && !used.has(cur)) {
      used.add(cur);
      ring.push({ x: cur.ax, y: cur.ay });
      const nk = key(cur.bx, cur.by);
      if (nk === startKey) break;
      const next: Seg[] = byStart.get(nk) ?? [];
      cur = next.find((s) => !used.has(s));
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * Build a mask of the pixels that "belong" to a colour layer.
 *
 * `threshold` is applied to luminance, so a dark logo on a light background
 * comes out as the logo. Inverting swaps which side is kept.
 */
export function maskFromImage(
  img: ImageData,
  threshold: number,
  invert: boolean,
): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = img.data[p + 3] / 255;
    const lum =
      (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000 * a +
      255 * (1 - a);
    const on = lum < threshold;
    out[i] = (invert ? !on : on) ? 1 : 0;
  }
  return out;
}
