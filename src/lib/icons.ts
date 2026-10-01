import type { Pt } from './types';
import { svgPathToRings } from './geom/svgPath';
import { circleRing, nestRings, ringInsideRing, roundedRectRing, signedArea, type Ring } from './geom/poly';
import { cleanRegions } from './geom/boolean';

/**
 * Icons for the panel, from Iconify.
 *
 * Iconify's public API serves dozens of open-licensed icon sets by name,
 * needs no key, allows requests straight from the browser and caches them for
 * a week, so icons are picked here and fetched on demand rather than shipped
 * with the app or uploaded by hand.
 *
 * Only sets drawn as filled shapes are offered. A panel icon is extruded or
 * cut like lettering, so it needs outlines that enclose something; sets drawn
 * as hairline strokes (Tabler, Lucide) have nothing to fill.
 */

const API = 'https://api.iconify.design';

export const ICON_SETS = [
  { prefix: 'mdi', name: 'Material Design Icons', license: 'Apache 2.0' },
  { prefix: 'ph', name: 'Phosphor', license: 'MIT' },
  { prefix: 'material-symbols', name: 'Material Symbols', license: 'Apache 2.0' },
] as const;

/** What a panel usually wants an icon for, so the picker is useful before typing. */
export const QUICK_ICONS = [
  'mdi:sine-wave', 'mdi:square-wave', 'mdi:triangle-wave', 'mdi:sawtooth-wave', 'mdi:waveform',
  'mdi:arrow-right-bold', 'mdi:arrow-left-bold', 'mdi:arrow-up-bold', 'mdi:arrow-down-bold',
  'mdi:power', 'mdi:clock-outline', 'mdi:sync', 'mdi:repeat', 'mdi:shuffle-variant', 'mdi:dice-5',
  'mdi:play', 'mdi:pause', 'mdi:music-note', 'mdi:volume-high', 'mdi:filter',
  'mdi:lightning-bolt', 'mdi:plus', 'mdi:minus', 'mdi:circle', 'mdi:star', 'mdi:skull',
];

/** Default width of a placed icon's drawing area, mm: label-sized. */
export const ICON_SIZE_MM = 6;

/**
 * Phosphor's thin and light weights would be strokes a tenth of a millimetre
 * wide at panel size, and its duotone weight is two shades that a printer
 * cannot show; neither is worth offering.
 */
function printable(id: string): boolean {
  return !/^ph:.*-(thin|light|duotone)$/.test(id);
}

/**
 * Iconify's public API limits how often one visitor may call it, so every
 * answer is kept for the session: a search typed again, or an icon shown in
 * one search and picked from the next, costs nothing more.
 */
const searches = new Map<string, Promise<string[]>>();

export function searchIcons(query: string, signal?: AbortSignal): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (!q) return Promise.resolve([]);
  const hit = searches.get(q);
  if (hit) return hit;
  const prefixes = ICON_SETS.map((s) => s.prefix).join(',');
  const p = getJson<{ icons?: string[] }>(
    `${API}/search?query=${encodeURIComponent(q)}&limit=64&prefixes=${prefixes}`, 'Icon search failed', signal,
  ).then((data) => (data.icons ?? []).filter(printable));
  searches.set(q, p);
  // A search given up on, or refused, is asked again next time.
  p.catch(() => searches.delete(q));
  return p;
}

async function getJson<T>(url: string, what: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new Error(`${what}: Iconify is busy, try again in a minute`);
  if (!res.ok) throw new Error(`${what} (${res.status})`);
  return (await res.json()) as T;
}

/** "mdi:sine-wave" → "Sine wave". */
export function iconLabel(id: string): string {
  const name = id.split(':')[1] ?? id;
  const words = name.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface IconData { body: string; width: number; height: number }

const cache = new Map<string, Promise<IconData>>();

export function fetchIcon(id: string): Promise<IconData> {
  return fetchIcons([id]).get(id)!;
}

/**
 * Several icons at once: one request per set rather than one per icon, so a
 * page of search results is two or three calls instead of sixty.
 */
export function fetchIcons(ids: string[]): Map<string, Promise<IconData>> {
  const out = new Map<string, Promise<IconData>>();
  const wanted = new Map<string, string[]>();
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit) { out.set(id, hit); continue; }
    const [prefix, name] = id.split(':');
    if (!prefix || !name) { out.set(id, Promise.reject(new Error(`Not an icon name: ${id}`))); continue; }
    wanted.set(prefix, [...(wanted.get(prefix) ?? []), name]);
  }
  for (const [prefix, names] of wanted) {
    const set = getJson<IconSetJson>(
      `${API}/${encodeURIComponent(prefix)}.json?icons=${names.map(encodeURIComponent).join(',')}`,
      'Could not load the icon',
    );
    for (const name of names) {
      const id = `${prefix}:${name}`;
      const p = set.then((s) => iconFromSet(s, name));
      cache.set(id, p);
      p.catch(() => cache.delete(id));
      out.set(id, p);
    }
  }
  return out;
}

/**
 * A preview drawn from the icon's own data, as an image so nothing in it can
 * run. It costs no request of its own and shows the shapes that get printed.
 */
export function iconPreviewSrc(icon: IconData, color = '#1d1d1b'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}" color="${color}">${icon.body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Whether an icon is drawn in a way that can be printed, judged without building it. */
export function printableBody(body: string): boolean {
  return !UNPRINTABLE.some(([re]) => re.test(body));
}

const UNPRINTABLE: Array<[RegExp, string]> = [
  [/\bstroke(-width)?="(?!none)[^"]*"/, 'That icon is drawn with lines rather than filled shapes, so there is nothing to print'],
  [/\b(opacity|fill-opacity)="/, 'That icon uses shading, which cannot be printed in one colour'],
  [/\btransform="/, 'That icon is drawn in a way this cannot read yet; pick another'],
];

interface IconSetJson {
  width?: number;
  height?: number;
  icons?: Record<string, { body: string; width?: number; height?: number }>;
  aliases?: Record<string, { parent: string; rotate?: number; hFlip?: boolean; vFlip?: boolean }>;
}

/** One icon out of an Iconify set response, following a plain alias. */
export function iconFromSet(set: IconSetJson, name: string): IconData {
  let icon = set.icons?.[name];
  const alias = set.aliases?.[name];
  if (!icon && alias) {
    // A turned or mirrored alias would need its transform applied; the set
    // always has the plain icon under its own name, which is what to pick.
    if (alias.rotate || alias.hFlip || alias.vFlip) throw new Error('That icon is a turned copy of another; pick the original');
    icon = set.icons?.[alias.parent];
  }
  if (!icon) throw new Error(`No icon called ${name}`);
  return { body: icon.body, width: icon.width ?? set.width ?? 16, height: icon.height ?? set.height ?? 16 };
}

/**
 * The icon's outlines in mm, centred on the middle of what is drawn.
 *
 * Sized by the icon's own drawing area rather than by its ink, so icons of
 * one set come out at matching sizes: an arrow and a dot keep their relative
 * proportions, as they were designed to.
 */
export function iconToRings(icon: IconData, sizeMm = ICON_SIZE_MM): Ring[] {
  const shapes = bodyToShapes(icon.body, Math.max(icon.width, icon.height) / 600);
  if (shapes.length === 0) throw new Error('That icon has nothing to fill');

  // Each element is filled by its own rule, and elements are painted over
  // one another, so the icon is the union of what each one fills.
  const regions = cleanRegions(shapes.flatMap((s) => nestRings(s.evenOdd ? s.rings : nonzeroRings(s.rings))));
  const rings = regions.flatMap((r) => [r.outer, ...r.holes]);
  if (rings.length === 0) throw new Error('That icon has nothing to fill');

  const k = sizeMm / Math.max(icon.width, icon.height);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return rings.map((r) => r.map((p): Pt => ({ x: (p.x - cx) * k, y: (p.y - cy) * k })));
}

interface Shape { rings: Ring[]; evenOdd: boolean }

/**
 * The filled shapes in an icon's SVG body.
 *
 * Icon bodies are small and regular — paths, the odd circle or rectangle, a
 * group to share a fill — so they are read directly rather than through a
 * DOM, which also keeps this usable outside the browser. Anything drawn with
 * a stroke, faded with opacity or moved by a transform is refused rather
 * than silently drawn wrong.
 */
export function bodyToShapes(body: string, tolerance: number): Shape[] {
  for (const [re, why] of UNPRINTABLE) if (re.test(body)) throw new Error(why);

  const shapes: Shape[] = [];
  const groupEvenOdd = /<g\b[^>]*fill-rule="evenodd"/.test(body);
  const re = /<(path|circle|ellipse|rect|polygon)\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const [, tag, attrText] = m;
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrText)?.[1];
    if (attr('fill') === 'none') continue;
    const evenOdd = (attr('fill-rule') ?? (groupEvenOdd ? 'evenodd' : 'nonzero')) === 'evenodd';
    const n = (name: string, fallback = 0) => {
      const v = attr(name);
      return v === undefined ? fallback : Number(v);
    };
    let rings: Ring[] = [];
    if (tag === 'path') {
      const d = attr('d');
      if (d) rings = svgPathToRings(d, tolerance);
    } else if (tag === 'circle') {
      if (n('r') > 0) rings = [circleRing(n('cx'), n('cy'), 2 * n('r'), tolerance)];
    } else if (tag === 'ellipse') {
      const rx = n('rx'), ry = n('ry');
      if (rx > 0 && ry > 0) {
        const c = circleRing(0, 0, 2, tolerance / Math.max(rx, ry));
        rings = [c.map((p) => ({ x: n('cx') + p.x * rx, y: n('cy') + p.y * ry }))];
      }
    } else if (tag === 'rect') {
      const w = n('width'), h = n('height');
      if (w > 0 && h > 0) {
        const r = Math.min(n('rx', n('ry')), w / 2, h / 2);
        rings = [roundedRectRing(n('x') + w / 2, n('y') + h / 2, w, h, r)];
      }
    } else if (tag === 'polygon') {
      const v = (attr('points') ?? '').trim().split(/[\s,]+/).map(Number);
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i], y: v[i + 1] });
      if (pts.length >= 3) rings = [pts];
    }
    if (rings.length) shapes.push({ rings, evenOdd });
  }
  return shapes;
}

/**
 * The rings that bound what a nonzero fill paints, ready to be nested by
 * containment like any other outlines.
 *
 * Icons are filled by the nonzero rule: a hole is a subpath wound the other
 * way, and a subpath wound the same way inside another is just more of the
 * same fill. Nesting by containment alone would turn that second case into a
 * hole. So the winding is added up down the nesting, and only rings where
 * the fill actually changes — filled on one side, empty on the other — are
 * kept.
 */
export function nonzeroRings(rings: Ring[]): Ring[] {
  const valid = rings.filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-12);
  const area = valid.map((r) => Math.abs(signedArea(r)));
  // Each ring's parent is the smallest ring that contains it.
  const parent = valid.map((r, i) => {
    let best = -1;
    for (let j = 0; j < valid.length; j++) {
      if (j === i || area[j] <= area[i]) continue;
      if (ringInsideRing(r, valid[j]) && (best < 0 || area[j] < area[best])) best = j;
    }
    return best;
  });
  const winding = new Array<number | undefined>(valid.length);
  const windOf = (i: number): number => {
    if (winding[i] === undefined) {
      winding[i] = Math.sign(signedArea(valid[i])) + (parent[i] >= 0 ? windOf(parent[i]) : 0);
    }
    return winding[i]!;
  };
  return valid.filter((_, i) => {
    const inside = windOf(i) !== 0;
    const outside = parent[i] >= 0 ? windOf(parent[i]) !== 0 : false;
    return inside !== outside;
  });
}
