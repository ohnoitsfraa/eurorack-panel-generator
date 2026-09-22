import type { Gray } from './image';

/** Otsu's method: the threshold that maximises between-class variance. */
export function otsu(g: Gray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = v; }
  }
  return best;
}

/** Binary mask of pixels darker than `t`. 1 = candidate hole. */
export function binarizeDark(g: Gray, t: number): Uint8Array {
  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++) out[i] = g.data[i] < t ? 1 : 0;
  return out;
}

/**
 * Threshold levels to sweep when hunting for blobs.
 *
 * A single global threshold fails on real photographs: a black jack nut and a
 * dark-grey screened label can sit either side of it depending on exposure.
 * Sweeping a ladder of levels and keeping the shapes that stay stable across
 * several of them (the idea behind MSER) is far more forgiving.
 */
export function thresholdLadder(g: Gray, lo: number, hi: number, steps: number): number[] {
  const o = otsu(g);
  const levels = new Set<number>();
  levels.add(o);
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps;
    levels.add(Math.round(lo + (hi - lo) * f));
  }
  return [...levels].filter((v) => v > 2 && v < 253).sort((a, b) => a - b);
}
