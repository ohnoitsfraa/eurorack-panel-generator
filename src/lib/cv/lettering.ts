import type { Gray } from './image';
import { percentiles } from './image';
import { binarizeDark, binarizeLight } from './threshold';
import { findBlobs, type Blob } from './components';
import type { Candidate } from './classify';

/**
 * Finding the panel's lettering, so it is not taken for cutouts.
 *
 * Panel printing is small, dark and round enough to pass every shape test a
 * hole has to pass. An O is a ring like a knob outline, a 0 or a dot is a
 * disc like an LED, and on a dark panel the dark insides of O, D, 8 and B are
 * dark islands exactly like holes. Looked at one at a time they cannot be
 * told apart; what gives lettering away is its company. Letters come in rows
 * of shapes the same height, most of them not round at all, and a letter's
 * counter sits inside a stroke as thin as the rest of the word's.
 *
 * So the lettering is found first, once per picture, in both colours: shapes
 * the size of letters, grouped into lines. A hole candidate that turns out to
 * be one of those letters, or the inside of one, is dropped before it can
 * take part in anything else — before it is merged, voted on for size, or
 * found to overlap a real hole and take that hole down with it.
 *
 * When nothing reads as lettering, nothing is dropped. The filter can only
 * remove what it has positively recognised, so a picture it makes no sense of
 * is treated exactly as it was before it existed.
 */

/** How tall a letter is, mm. Titles bigger than this are left alone. */
const GLYPH_HEIGHT_MM = { min: 1.2, max: 6 } as const;
/** How far the threshold has to be from the panel colour to count as ink. */
const MIN_INK_CONTRAST = 30;
/**
 * How far from the panel colour towards the extremes the ink thresholds sit.
 *
 * Two of them, because no one level suits all printing. The extremes are the
 * holes rather than the ink, so halfway cuts faint grey lettering in two at
 * the middle of its strokes, and a broken letter is not recognised as one;
 * closer to the panel, tightly set bold letters run together through their
 * soft edges, and a word is not a letter either. Each level finds what the
 * other misses, so both are looked at.
 */
const INK_REACH = [0.5, 0.3] as const;
/** More letter-like shapes than this is a textured photo, not a panel. */
const MAX_SEEDS = 1500;

export type Polarity = 'dark' | 'light';
type Axis = 'h' | 'v';

interface Hole { area: number; cx: number; cy: number; w: number; h: number }

export interface GlyphComp {
  /** Index into LetteringMap.comps. */
  id: number;
  polarity: Polarity;
  blob: Blob;
  /** Bounding box size, px. */
  bw: number;
  bh: number;
  /** Average stroke width, px: twice the area over the boundary length. */
  strokePx: number;
  holes: Hole[];
  /** Round to the eye: a disc, a ring, an O. */
  circlePerfect: boolean;
  /** One round hole dead centre in a round outline: a nut, a bezel, an O. */
  hardwareLike: boolean;
  /** A letter by its own shape: 8, B, 6, 9, P, A, 0, D. */
  glyphShaped: boolean;
  /** The text line it belongs to, or -1. */
  line: number;
}

export interface TextLine {
  id: number;
  axis: Axis;
  polarity: Polarity;
  /** Letter height across the line, px. */
  heightPx: number;
  members: number[];
}

export interface LetteringMap {
  width: number;
  height: number;
  mmPerPx: number;
  /** One per colour and threshold: component index + 1 per pixel, or 0. */
  layers: Array<{ polarity: Polarity; labels: Int32Array }>;
  comps: GlyphComp[];
  lines: TextLine[];
}

export function findLettering(gray: Gray, mmPerPx: number): LetteringMap {
  const { width, height } = gray;
  const map: LetteringMap = { width, height, mmPerPx, layers: [], comps: [], lines: [] };

  // Thresholds measured from the panel's own colour towards its darkest or
  // lightest pixels. Not Otsu: on a mid-grey panel with both black and white
  // printing it puts one of the two on the panel's side. Not a local
  // threshold either, which draws a light halo round every dark hole — the
  // very picture of a counter inside a letter.
  const bg = median(gray);
  const [p02, p98] = percentiles(gray, 0.02, 0.98);
  const pxPerMm2 = 1 / (mmPerPx * mmPerPx);
  const minArea = Math.max(4, 0.25 * pxPerMm2);
  // Two or three letters that ran together are still lettering.
  const maxArea = GLYPH_HEIGHT_MM.max * GLYPH_HEIGHT_MM.max * 3 * pxPerMm2;

  for (const polarity of ['dark', 'light'] as const) {
    const contrast = polarity === 'dark' ? bg - p02 : p98 - bg;
    if (contrast < MIN_INK_CONTRAST) continue;
    for (const reach of INK_REACH) {
      const t = polarity === 'dark' ? bg - reach * contrast : bg + reach * contrast;
      const mask = polarity === 'dark' ? binarizeDark(gray, t) : binarizeLight(gray, t);
      const labels = new Int32Array(width * height);
      const blobs = findBlobs(mask, width, height, minArea, maxArea, t, labels);

      // Labels are per pass; make them global component ids.
      const base = map.comps.length;
      const keep = new Int32Array(blobs.length + 1);
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        if (b.touchesBorder || !glyphSized(b, mmPerPx)) continue;
        const comp = measure(b, i + 1, labels, width, height, mmPerPx, polarity, map.comps.length);
        map.comps.push(comp);
        keep[i + 1] = comp.id + 1;
      }
      for (let p = 0; p < labels.length; p++) if (labels[p]) labels[p] = keep[labels[p]];
      map.layers.push({ polarity, labels });

      for (const axis of ['h', 'v'] as const) {
        buildLines(map, map.comps.slice(base), polarity, axis);
      }
    }
  }
  return map;
}

/**
 * Is this hole candidate really lettering? Returns a key for the letter it
 * belongs to, so one letter seen at many threshold levels counts once, or
 * null to keep it.
 */
export function letteringHit(map: LetteringMap, b: Blob, c: Candidate): string | null {
  const id = letterFor(map, b, c);
  if (id === null) return null;
  // The same letter is found at both ink levels, as two components; where it
  // sits, to half a millimetre, is what makes it one letter.
  const g = map.comps[id];
  const at = (v: number) => Math.round(v * map.mmPerPx * 2);
  return `${g.polarity}:${at(g.blob.cx)}:${at(g.blob.cy)}`;
}

function letterFor(map: LetteringMap, b: Blob, c: Candidate): number | null {
  const glyph = glyphFor(map, b);
  const isCircle = c.feature.shape === 'circle';
  // A round reading is compared by its box, not by the size it was measured
  // at: a letter's measured size runs along its diagonal and grows with the
  // blur at a light threshold, while a real hole's box is just its diameter.
  const sizeMm = (isCircle ? Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1 : b.major) * map.mmPerPx;
  // A slot or window has to be a good deal longer than the letters it sits
  // among; a circle has only to be about their size.
  const lineLimit = isCircle ? 1.3 : 1.5;

  if (glyph) {
    const line = glyph.line >= 0 ? map.lines[glyph.line] : null;
    if (line && sizeMm <= lineLimit * line.heightPx * map.mmPerPx) return glyph.id;
    const glyphMm = Math.max(glyph.bw, glyph.bh) * map.mmPerPx;
    if (!line && glyph.glyphShaped && sizeMm <= 1.3 * glyphMm) return glyph.id;
  }

  // Readings that do not map cleanly onto one letter — two letters run
  // together at a darker level, a fragment at a lighter one — still land in
  // the middle of the word.
  for (const line of map.lines) {
    const h = line.heightPx;
    if (sizeMm > lineLimit * h * map.mmPerPx) continue;
    const pad = 0.2 * h;
    for (const m of line.members) {
      const g = map.comps[m].blob;
      if (b.cx >= g.x0 - pad && b.cx <= g.x1 + pad && b.cy >= g.y0 - pad && b.cy <= g.y1 + pad) return m;
    }
  }
  return null;
}

/**
 * The letter a blob is, or is the inside of.
 *
 * Found by looking outwards from its centre. Light lettering on a dark panel:
 * a counter is surrounded on all sides by the same light letter. Dark
 * lettering: the blob is that letter, seen at another threshold, so the
 * letter is under its centre or, for an O, all around it, and the two cover
 * much the same box.
 */
function glyphFor(map: LetteringMap, b: Blob): GlyphComp | null {
  const reach = 0.8 * Math.max(b.major, b.minor) + 2;
  // A letter in a line is the stronger finding, so it wins over a lone one
  // found at the other ink level.
  let found: GlyphComp | null = null;
  for (const { polarity, labels } of map.layers) {
    let g: GlyphComp | null = null;
    if (polarity === 'light') {
      const hit = sameOnAllRays(labels, map, b.cx, b.cy, reach);
      if (hit) {
        const gb = map.comps[hit - 1].blob;
        if (gb.x0 <= b.x0 && gb.y0 <= b.y0 && gb.x1 >= b.x1 && gb.y1 >= b.y1) g = map.comps[hit - 1];
      }
    } else {
      const at = labels[Math.round(b.cy) * map.width + Math.round(b.cx)];
      const hit = at || sameOnAllRays(labels, map, b.cx, b.cy, b.major / 2 + 2, 3);
      if (hit && iou(map.comps[hit - 1].blob, b) >= 0.5) g = map.comps[hit - 1];
    }
    if (g && (!found || (found.line < 0 && g.line >= 0))) found = g;
  }
  return found;
}

/** The label that at least `need` of four rays from (x, y) meet first. */
function sameOnAllRays(labels: Int32Array, map: LetteringMap, x: number, y: number, reach: number, need = 4): number {
  const found: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let hit = 0;
    for (let r = 0; r <= reach; r++) {
      const px = Math.round(x + dx * r);
      const py = Math.round(y + dy * r);
      if (px < 0 || py < 0 || px >= map.width || py >= map.height) break;
      const l = labels[py * map.width + px];
      if (l) { hit = l; break; }
    }
    if (hit) found.push(hit);
  }
  for (const l of found) if (found.filter((f) => f === l).length >= need) return l;
  return 0;
}

function glyphSized(b: Blob, mmPerPx: number): boolean {
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  return fitsAxis(bh, bw, mmPerPx) || fitsAxis(bw, bh, mmPerPx);
}

/** Letter-sized when read with `across` as the letter height. */
function fitsAxis(across: number, along: number, mmPerPx: number): boolean {
  const mm = across * mmPerPx;
  return mm >= GLYPH_HEIGHT_MM.min && mm <= GLYPH_HEIGHT_MM.max && along >= 0.1 * across && along <= 3 * across;
}

/** Stroke, holes and shape of one component, from its own box. */
function measure(
  b: Blob, label: number, labels: Int32Array, width: number, height: number,
  mmPerPx: number, polarity: Polarity, id: number,
): GlyphComp {
  // The box with a one-pixel margin, so everything outside the letter is
  // connected and can be flooded from the edge.
  const ox = b.x0 - 1, oy = b.y0 - 1;
  const w = b.x1 - b.x0 + 3, h = b.y1 - b.y0 + 3;
  const mine = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const iy = oy + y;
    if (iy < 0 || iy >= height) continue;
    for (let x = 0; x < w; x++) {
      const ix = ox + x;
      if (ix < 0 || ix >= width) continue;
      if (labels[iy * width + ix] === label) mine[y * w + x] = 1;
    }
  }

  let boundary = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mine[i] && (!mine[i - 1] || !mine[i + 1] || !mine[i - w] || !mine[i + w])) boundary++;
    }
  }

  // Flood the outside from the margin; whatever is left unreached and not
  // part of the letter is a hole in it.
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || mine[i]) continue;
    seen[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  const holes: Hole[] = [];
  const minHole = Math.max(3, 0.05 / (mmPerPx * mmPerPx));
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || mine[s]) continue;
    let area = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i] || mine[i]) continue;
      seen[i] = 1;
      const x = i % w, y = (i / w) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      stack.push(i - 1, i + 1, i - w, i + w);
    }
    if (area >= minHole) holes.push({ area, cx: ox + sx / area, cy: oy + sy / area, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }

  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const size = Math.max(bw, bh);
  const holeArea = holes.reduce((a, o) => a + o.area, 0);
  // Fill of the outline with its holes filled in: a ring and a disc of the
  // same rim look the same here, which is the point.
  const outlineFill = (b.area + holeArea) / Math.max(1, b.major * b.minor);
  const circlePerfect = b.elongation <= 1.12 && Math.abs(outlineFill - Math.PI / 4) <= 0.06;

  const hole = holes.length === 1 ? holes[0] : null;
  const holeElongation = hole ? Math.max(hole.w, hole.h) / Math.max(1, Math.min(hole.w, hole.h)) : 0;
  const holeFill = hole ? hole.area / (hole.w * hole.h) : 0;
  const holeOffset = hole ? Math.hypot(hole.cx - b.cx, hole.cy - b.cy) : 0;
  const hardwareLike = !!hole
    && holeElongation <= 1.15
    && Math.abs(holeFill - Math.PI / 4) <= 0.08
    && holeOffset <= 0.08 * size
    && b.elongation <= 1.15;
  const glyphShaped = !hardwareLike && (
    holes.length >= 2
    || (!!hole && (holeOffset > 0.12 * size || holeElongation >= 1.3 || !circlePerfect))
  );

  return {
    id, polarity, blob: b, bw, bh,
    strokePx: (2 * b.area) / Math.max(1, boundary),
    holes, circlePerfect, hardwareLike, glyphShaped,
    line: -1,
  };
}

/**
 * Group letters into lines of text, along one axis.
 *
 * Only shapes that could not be hardware may start a line: thin-stroked,
 * letter-sized, and not round. Round ones may join a line that is already
 * there, under tight conditions — that is how the O of "OUT" is caught —
 * but a row of LEDs, however evenly spaced, never becomes text on its own.
 */
function buildLines(map: LetteringMap, comps: GlyphComp[], polarity: Polarity, axis: Axis): void {
  const across = (g: GlyphComp) => (axis === 'h' ? g.bh : g.bw);
  const start = (g: GlyphComp) => (axis === 'h' ? g.blob.x0 : g.blob.y0);
  const end = (g: GlyphComp) => (axis === 'h' ? g.blob.x1 : g.blob.y1);
  const mid = (g: GlyphComp) => (axis === 'h' ? (g.blob.y0 + g.blob.y1) / 2 : (g.blob.x0 + g.blob.x1) / 2);
  const lo = (g: GlyphComp) => (axis === 'h' ? g.blob.y0 : g.blob.x0);
  const hi = (g: GlyphComp) => (axis === 'h' ? g.blob.y1 : g.blob.x1);
  const fits = (g: GlyphComp) => fitsAxis(across(g), axis === 'h' ? g.bw : g.bh, map.mmPerPx);

  const free = comps.filter((g) => g.line < 0 && fits(g));
  const seeds = free.filter((g) => !g.circlePerfect && !g.hardwareLike && g.strokePx <= 0.32 * across(g));
  if (seeds.length < 2 || seeds.length > MAX_SEEDS) return;

  // Union-find over seeds that sit side by side like neighbouring letters.
  seeds.sort((a, b) => start(a) - start(b));
  const parent = seeds.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < seeds.length; i++) {
    const a = seeds[i];
    const ha = across(a);
    for (let j = i + 1; j < seeds.length; j++) {
      const b = seeds[j];
      if (start(b) - end(a) > 0.9 * ha * 1.6) break;
      const hb = across(b);
      const hmax = Math.max(ha, hb);
      if (hmax / Math.min(ha, hb) > 1.6) continue;
      const gap = start(b) - end(a);
      if (gap < -0.3 * hmax || gap > 0.9 * Math.min(ha, hb)) continue;
      const aligned = Math.abs(mid(a) - mid(b)) <= 0.35 * hmax
        || Math.abs(lo(a) - lo(b)) <= 0.2 * hmax
        || Math.abs(hi(a) - hi(b)) <= 0.2 * hmax;
      if (aligned) parent[find(i)] = find(j);
    }
  }

  const groups = new Map<number, GlyphComp[]>();
  seeds.forEach((g, i) => {
    const r = find(i);
    const list = groups.get(r) ?? [];
    list.push(g);
    groups.set(r, list);
  });

  // Only ring-shaped round ones: a round letter is an O, an o, a 0, always
  // with a hole in it. A solid disc is an LED or a bullet beside the label,
  // and must not be swallowed with it.
  const roundOnes = free.filter((g) => (g.circlePerfect || g.hardwareLike) && g.holes.length > 0
    && g.strokePx <= 0.32 * across(g));
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const h = medianOf(members.map(across));
    const centre = medianOf(members.map(mid));

    // Round shapes join only if they look like one more letter of this line:
    // the same height, on the same centre line, and right beside a member.
    for (let pass = 0; pass < 3; pass++) {
      let added = false;
      for (const g of roundOnes) {
        if (members.includes(g)) continue;
        const ratio = across(g) / h;
        if (ratio < 0.6 || ratio > 1.15 || Math.abs(mid(g) - centre) > 0.25 * h) continue;
        const near = members.some((m) => {
          const gap = Math.max(start(g) - end(m), start(m) - end(g));
          const overlapAcross = Math.min(hi(g), hi(m)) - Math.max(lo(g), lo(m));
          return gap <= 0.45 * h && overlapAcross > 0;
        });
        if (near) { members.push(g); added = true; }
      }
      if (!added) break;
    }

    if (identicalRow(members, across, start, end, h)) continue;

    const line: TextLine = {
      id: map.lines.length, axis, polarity, heightPx: h, members: members.map((m) => m.id),
    };
    for (const m of members) m.line = line.id;
    map.lines.push(line);
  }
}

/**
 * A row of the same shape at an even pitch is hardware — square buttons, a
 * strip of nuts — however letter-like each one is. Real words repeat letters
 * but never only one, evenly.
 */
function identicalRow(
  members: GlyphComp[], across: (g: GlyphComp) => number,
  start: (g: GlyphComp) => number, end: (g: GlyphComp) => number, h: number,
): boolean {
  if (members.length < 3) return false;
  const areas = members.map((m) => m.blob.area);
  const area = medianOf(areas);
  if (!areas.every((a) => Math.abs(a - area) <= 0.2 * area)) return false;
  if (!members.every((m) => Math.abs(across(m) - h) <= 0.1 * h)) return false;
  if (!members.every((m) => m.holes.length === members[0].holes.length)) return false;
  const sorted = [...members].sort((a, b) => start(a) - start(b));
  const gaps = sorted.slice(1).map((m, i) => start(m) - end(sorted[i]));
  return Math.max(...gaps) - Math.min(...gaps) <= 0.15 * h;
}

function iou(a: Blob, b: Blob): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1);
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1);
  const inter = ix * iy;
  const area = (q: Blob) => (q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1);
  return inter / Math.max(1, area(a) + area(b) - inter);
}

function median(g: Gray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= g.data.length / 2) return v;
  }
  return 128;
}

function medianOf(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
