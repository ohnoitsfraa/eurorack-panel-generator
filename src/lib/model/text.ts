import { parse, type Font, type Path } from 'opentype.js';
import type { DecorElement, Pt, TextElement } from '../types';
import type { Ring } from '../geom/poly';

/**
 * Text -> outline rings.
 *
 * Panels are covered in small labels, so this has to be exact rather than
 * approximate: every glyph becomes real polygons that get extruded as relief
 * or sunk as an engraving. opentype.js gives us the contours; the work here is
 * flattening the curves and laying the glyphs out at a size the user can
 * reason about.
 */

const fontCache = new Map<string, Promise<Font>>();

export function fontKey(family: string, weight: number): string {
  return `${family}@${weight}`;
}

/**
 * Load a font by family and weight.
 *
 * Goes through our own API route: the Google Fonts CSS endpoint only hands out
 * TrueType to an old User-Agent, and a browser cannot set that header, so the
 * resolution has to happen server-side.
 */
export function loadFont(family: string, weight: number): Promise<Font> {
  const key = fontKey(family, weight);
  const hit = fontCache.get(key);
  if (hit) return hit;

  const p = (async () => {
    const res = await fetch(`/api/font?family=${encodeURIComponent(family)}&weight=${weight}`);
    if (!res.ok) throw new Error(`Could not load font "${family}" (${res.status})`);
    return parse(await res.arrayBuffer());
  })();

  fontCache.set(key, p);
  // A failed load should not poison the cache for a later retry.
  p.catch(() => fontCache.delete(key));
  return p;
}

/** Register a user-uploaded font file so it can be used like a built-in one. */
export function registerFont(family: string, weight: number, buf: ArrayBuffer): void {
  fontCache.set(fontKey(family, weight), Promise.resolve(parse(buf)));
}

export function isFontLoaded(family: string, weight: number): boolean {
  return fontCache.has(fontKey(family, weight));
}

/** Every family and weight this design's lettering needs to build. */
export function fontsUsedBy(design: { decor: TextElement[] | DecorElement[] }): FontNeed[] {
  const needed = new Map<string, FontNeed>();
  for (const d of design.decor) {
    if (d.type !== 'text') continue;
    needed.set(fontKey(d.fontFamily, d.fontWeight), { family: d.fontFamily, weight: d.fontWeight });
  }
  return [...needed.values()];
}

export interface FontNeed { family: string; weight: number }

/**
 * Resolve once every font asked for so far has settled.
 *
 * For the export paths: a panel that goes to the printer missing its lettering
 * is a wasted print, so a download waits out a load that is still in flight
 * rather than quietly building without it. Settled rather than resolved,
 * because a font that cannot be fetched should not hang the download — that
 * one surfaces as an error of its own.
 */
export async function fontsSettled(): Promise<void> {
  await Promise.allSettled([...fontCache.values()]);
}

/**
 * Ratio of cap height to em size.
 *
 * Users think in terms of "5 mm tall letters", not em size, so we scale by cap
 * height. Not every font declares one; 0.7 em is a safe stand-in.
 */
function capHeightRatio(font: Font): number {
  const os2 = (font.tables as { os2?: { sCapHeight?: number } }).os2;
  const cap = os2?.sCapHeight;
  if (cap && cap > 0) return cap / font.unitsPerEm;
  return 0.7;
}

/**
 * Lay out a text element and return its outline rings in panel millimetres.
 *
 * Rings come back unsorted and possibly nested (the counter of an "o", the two
 * holes in a "B"); `nestRings` sorts out solid from hole downstream.
 */
export function textToRings(el: TextElement, font: Font): Ring[] {
  const fontSize = el.sizeMm / capHeightRatio(font);
  const scale = fontSize / font.unitsPerEm;

  // Map characters straight to glyphs rather than going through
  // stringToGlyphs. That routine runs opentype's OpenType feature engine,
  // which throws outright on fonts using lookup types it has not implemented
  // (Inter is one). Panel labels are short and need no shaping, so the direct
  // route is both safer and enough. Kerning still comes from the kern table.
  const chars = [...el.text];
  const glyphs = chars.map((ch) => font.charToGlyph(ch));

  // Advances first, so alignment is resolved before anything is placed.
  const advances: number[] = [];
  for (let i = 0; i < glyphs.length; i++) {
    const kern = i > 0 ? font.getKerningValue(glyphs[i - 1], glyphs[i]) : 0;
    advances.push(((glyphs[i].advanceWidth ?? 0) + kern) * scale);
  }
  const total =
    advances.reduce((a, b) => a + b, 0) + el.letterSpacing * Math.max(0, glyphs.length - 1);

  let penX = el.align === 'center' ? -total / 2 : el.align === 'right' ? -total : 0;

  const rings: Ring[] = [];
  for (let i = 0; i < glyphs.length; i++) {
    // Baseline at y = 0; opentype's getPath already uses a y-down frame, which
    // matches panel space, so no flip is needed here.
    const path = glyphs[i].getPath(penX, 0, fontSize);
    rings.push(...pathToRings(path));
    penX += advances[i] + el.letterSpacing;
  }

  // Shift so the element's anchor sits at the vertical middle of the cap
  // height rather than on the baseline; that is what "centre" means when you
  // are nudging a label between two jacks.
  const dy = el.sizeMm / 2;
  const placed = rings.map((r) => r.map((p) => ({ x: p.x, y: p.y + dy })));

  return placed.map((r) => rotateTranslateRing(r, el.rotation, el.x, el.y));
}

function rotateTranslateRing(r: Ring, deg: number, tx: number, ty: number): Ring {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return r.map((p) => ({ x: tx + p.x * c - p.y * s, y: ty + p.x * s + p.y * c }));
}

/** Flatten an opentype path's commands into closed polylines. */
export function pathToRings(path: Path): Ring[] {
  const rings: Ring[] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;

  const flush = () => {
    if (cur.length >= 3) rings.push(cur);
    cur = [];
  };

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        flush();
        x = cmd.x; y = cmd.y;
        cur.push({ x, y });
        break;
      case 'L':
        x = cmd.x; y = cmd.y;
        cur.push({ x, y });
        break;
      case 'Q': {
        const steps = curveSteps(x, y, cmd.x1, cmd.y1, cmd.x, cmd.y);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          cur.push({
            x: mt * mt * x + 2 * mt * t * cmd.x1 + t * t * cmd.x,
            y: mt * mt * y + 2 * mt * t * cmd.y1 + t * t * cmd.y,
          });
        }
        x = cmd.x; y = cmd.y;
        break;
      }
      case 'C': {
        const steps = curveSteps(x, y, cmd.x1, cmd.y1, cmd.x, cmd.y);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          cur.push({
            x: mt * mt * mt * x + 3 * mt * mt * t * cmd.x1 + 3 * mt * t * t * cmd.x2 + t * t * t * cmd.x,
            y: mt * mt * mt * y + 3 * mt * mt * t * cmd.y1 + 3 * mt * t * t * cmd.y2 + t * t * t * cmd.y,
          });
        }
        x = cmd.x; y = cmd.y;
        break;
      }
      case 'Z':
        flush();
        break;
    }
  }
  flush();
  return rings;
}

/**
 * Subdivision count for a curve, scaled to its size in millimetres.
 *
 * A 3 mm label does not need the segment count of a 30 mm title, and panels
 * carry a lot of small text, so over-tessellating here shows up directly in
 * export size and slicer load times.
 */
function curveSteps(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): number {
  const approx = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
  return Math.max(2, Math.min(24, Math.ceil(approx * 2.5)));
}
