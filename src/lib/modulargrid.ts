/**
 * ModularGrid lookup.
 *
 * ModularGrid publishes no API. Their module pages are stable and cheap to
 * read — one request returns the panel image, the name and the HP — so that is
 * what this does. Their *search* is a different matter: results are filtered
 * server-side against a session that only a real browser establishes, and
 * fetching the listing without it returns all fifteen thousand modules in
 * alphabetical order. Rather than ship a search box that quietly returns the
 * wrong thing, the UI sends people to ModularGrid's own search and takes the
 * link back.
 *
 * Off unless MODULARGRID_ENABLED is set, cached for a week, and rate limited.
 * Uploading a photo or pasting an image URL are first-class paths, so none of
 * this is required to use the app.
 */

export const MG_BASE = 'https://modulargrid.net';
const UA = 'EurorackPanelGenerator/0.1 (hobby faceplate tool)';

export function isEnabled(): boolean {
  return process.env.MODULARGRID_ENABLED === '1';
}

export interface MGModule {
  slug: string;
  name: string;
  hp?: number;
  imageUrl?: string;
  pageUrl: string;
}

/** Crude per-process token bucket, keyed by client IP. */
const buckets = new Map<string, { tokens: number; last: number }>();
const RATE = { capacity: 10, refillPerSec: 0.2 };

export function takeToken(ip: string): boolean {
  const now = Date.now() / 1000;
  const b = buckets.get(ip) ?? { tokens: RATE.capacity, last: now };
  b.tokens = Math.min(RATE.capacity, b.tokens + (now - b.last) * RATE.refillPerSec);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

/**
 * Pull a module slug out of whatever the user pasted.
 *
 * Accepts a full URL, with or without the scheme, host or `www`, and a bare
 * slug. ModularGrid serves module pages under several single-letter prefixes
 * (`/e/`, `/a/`, `/m/`, …) depending on where you came from, and they all
 * resolve to the same module.
 */
export function slugFromInput(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;

  const withoutHost = input
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^modulargrid\.net/i, '');

  const path = withoutHost.startsWith('/') ? withoutHost : `/${withoutHost}`;
  const m = path.match(/^\/(?:[a-z]\/)?([a-z0-9][a-z0-9-]{2,120})\/?(?:[?#].*)?$/i);
  if (!m) return null;

  const slug = m[1].toLowerCase();
  // These are site sections, not modules.
  if (/^(modules|racks|users|search|help|login|signup|patches|offers|vendors|forum|pages|img|js|css)$/.test(slug)) {
    return null;
  }
  return slug;
}

/** A link to ModularGrid's own search, with the term filled in. */
export function searchUrl(query: string): string {
  return `${MG_BASE}/e/modules/browser?SearchName=${encodeURIComponent(query.trim())}`;
}

export async function fetchModule(slug: string): Promise<MGModule> {
  if (!/^[a-z0-9][a-z0-9-]{2,120}$/.test(slug)) throw new Error('That does not look like a module link');

  const res = await fetch(`${MG_BASE}/e/${slug}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
    next: { revalidate: 60 * 60 * 24 * 7 },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error(`No module called "${slug}" on ModularGrid`);
  if (!res.ok) throw new Error(`ModularGrid returned ${res.status}`);

  return parseModulePage(await res.text(), slug);
}

export function parseModulePage(html: string, slug: string): MGModule {
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]*)"`, 'i'))?.[1];

  // The Open Graph image is the panel shot, and is far more stable than the
  // gallery markup around it.
  const ogImage = meta('image');
  const moduleId = html.match(/data-module-id="(\d+)"/)?.[1];

  // The page itself displays a 2x asset; at roughly double the resolution it
  // gives detection a great deal more to work with than the og: image.
  const retina = moduleId ? `${MG_BASE}/img/modcache/${moduleId}.vw@2x.jpg` : undefined;

  const rawTitle = meta('title') ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? slugToName(slug);
  const name = decodeEntities(rawTitle.replace(/<[^>]+>/g, '').replace(/\s*-\s*Eurorack Module.*$/i, '').trim());

  return {
    slug,
    name: name || slugToName(slug),
    hp: parseHp(html),
    imageUrl: retina ?? (ogImage ? absolutise(ogImage) : undefined),
    pageUrl: `${MG_BASE}/e/${slug}`,
  };
}

function parseHp(html: string): number | undefined {
  const m = html.match(/(\d{1,3})\s*HP\b/i);
  if (!m) return undefined;
  const hp = Number(m[1]);
  return hp >= 1 && hp <= 120 ? hp : undefined;
}

function absolutise(src: string): string {
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${MG_BASE}${src}`;
  return src;
}

function slugToName(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}
