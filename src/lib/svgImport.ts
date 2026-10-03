import type { Pt } from './types';
import { bbox, nestRings, type Ring } from './geom/poly';
import { cleanRegions, intersectRegions, subtractRegions } from './geom/boolean';
import { nonzeroRings, shapeRings } from './icons';

/**
 * SVG files, used as the outlines they already are.
 *
 * Tracing works from pixels, so a vector logo traced comes back as a
 * staircase approximation of curves the file states exactly. An SVG is read
 * for its shapes instead: each filled path, circle, rectangle, ellipse and
 * polygon, through whatever transforms and styles place and colour it.
 *
 * What a panel cannot take is left out and counted, so the person importing
 * can be told: strokes (a line has no inside to fill until an editor turns it
 * into an outline), text that has not been turned into outlines, and
 * embedded pictures.
 */

export interface SvgShape {
  /** Outline rings, already in the drawing's own frame. */
  rings: Ring[];
  evenOdd: boolean;
  /**
   * Filled white or near it. Logos knock shapes out of a dark mark by laying
   * white over it, so a light shape takes away from what is beneath it.
   */
  knockout: boolean;
}

export interface SvgSkipped { strokes: number; text: number; other: number }

/**
 * The outline of a stack of filled shapes, painted in order.
 *
 * Each shape fills by its own rule, dark shapes add, and light ones on top
 * cut away. Art that is all light, meant for a dark background, would cut
 * everything away, so it is taken as all fill instead.
 */
export function combineSvgShapes(
  shapes: SvgShape[],
  /** Keep only what lies inside this box, cut off at its edges. */
  clip?: { x: number; y: number; w: number; h: number },
): Ring[] {
  const own = (s: SvgShape) => nestRings(s.evenOdd ? s.rings : nonzeroRings(s.rings));
  const allLight = shapes.length > 0 && shapes.every((s) => s.knockout);

  let regions: ReturnType<typeof nestRings> = [];
  // Runs of filled shapes are joined in one go rather than one at a time,
  // since a logo can be hundreds of paths.
  let pending: ReturnType<typeof nestRings> = [];
  const flush = () => {
    if (pending.length) regions = cleanRegions([...regions, ...pending]);
    pending = [];
  };
  for (const s of shapes) {
    if (s.knockout && !allLight) {
      flush();
      if (regions.length) regions = subtractRegions(regions, cleanRegions(own(s)));
    } else {
      pending.push(...own(s));
    }
  }
  flush();
  if (clip) {
    const { x, y, w, h } = clip;
    regions = intersectRegions(regions, [{ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [] }]);
  }
  return regions.flatMap((r) => [r.outer, ...r.holes]);
}

/**
 * Rings scaled to fit a box and centred on the origin, keeping proportions:
 * as wide as asked unless that would make it taller than allowed.
 */
export function fitRings(rings: Ring[], maxWidthMm: number, maxHeightMm: number): Ring[] {
  if (!rings.length) return [];
  const b = bbox(rings);
  const w = Math.max(1e-9, b.x1 - b.x0), h = Math.max(1e-9, b.y1 - b.y0);
  const k = Math.min(maxWidthMm / w, maxHeightMm / h);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return rings.map((r) => r.map((p): Pt => ({ x: (p.x - cx) * k, y: (p.y - cy) * k })));
}

/** Whether a computed CSS colour is white or close to it. */
export function isLight(color: string): boolean {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.9;
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return /^white$/i.test(color.trim());
  const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.9;
}

/**
 * The filled shapes of an SVG file, in the browser.
 *
 * Drawn off-screen first, so the browser works out what the markup leaves
 * implicit: fills set by stylesheet classes, inherited through groups,
 * transforms nested several deep, a viewBox. Then each shape is read with
 * the transform that places it.
 */
export function readSvg(
  text: string,
  /**
   * The size to lay the drawing out at, which is what its coordinates come
   * back in. Given the size of a preview of the same file, a box drawn over
   * the preview lands on the same part of the drawing.
   */
  size?: { width: number; height: number },
): { shapes: SvgShape[]; skipped: SvgSkipped } {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.tagName.toLowerCase() !== 'svg') {
    throw new Error('That file could not be read as an SVG');
  }
  const host = document.createElement('div');
  // Out of sight by position and opacity, not visibility: every shape would
  // inherit a hidden visibility and be taken for hidden on purpose.
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1000px;height:1000px;opacity:0;pointer-events:none';
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  // Scripts in an imported file have no business running.
  svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
  if (size) {
    svg.setAttribute('width', String(size.width));
    svg.setAttribute('height', String(size.height));
    svg.style.display = 'block';
  }
  host.appendChild(svg);
  document.body.appendChild(host);

  const skipped: SvgSkipped = { strokes: 0, text: 0, other: 0 };
  const shapes: SvgShape[] = [];
  try {
    const box = svg.getBoundingClientRect();
    // Fine enough that curves stay smooth once scaled to a panel.
    const tolViewport = Math.max(box.width, box.height, 1) / 1200;
    const els = svg.querySelectorAll('path, circle, ellipse, rect, polygon, polyline, line, text, use, image');
    for (const el of Array.from(els)) {
      // Definitions are drawn only where something refers to them.
      if (el.closest('defs, clipPath, mask, symbol, pattern, marker')) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'text') { skipped.text++; continue; }
      if (tag === 'use' || tag === 'image') { skipped.other++; continue; }

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const stroked = cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0;
      const filled = tag !== 'line' && cs.fill !== 'none' && Number(cs.fillOpacity) !== 0;
      if (stroked) skipped.strokes++;
      if (!filled) continue;

      const m = (el as SVGGraphicsElement).getCTM();
      if (!m) continue;
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      const rings = shapeRings(tag, (name) => el.getAttribute(name) ?? undefined, tolViewport / scale)
        .map((r) => r.map((p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })));
      if (!rings.length) continue;
      shapes.push({ rings, evenOdd: cs.fillRule === 'evenodd', knockout: isLight(cs.fill) });
    }
  } finally {
    host.remove();
  }
  return { shapes, skipped };
}

/** Is this file an SVG, by its type or, failing that, its name? */
export function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}
