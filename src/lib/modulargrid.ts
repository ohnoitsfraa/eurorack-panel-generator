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
const UA = 'Panelmate/0.1 (hobby faceplate tool)';

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

/**
 * Crude per-process token bucket, keyed by client IP.
 *
 * Two allowances, because the two things cost ModularGrid very different
 * amounts. Opening a module fetches a page from them, so it stays tight.
 * Searching reads the index already held here and touches their servers not at
 * all, so throttling it as though it did only locks people out of their own
 * typing.
 */
const buckets = new Map<string, { tokens: number; last: number }>();
const RATES = {
  fetch: { capacity: 10, refillPerSec: 0.2 },
  search: { capacity: 60, refillPerSec: 2 },
} as const;

export function takeToken(ip: string, kind: keyof typeof RATES = 'fetch'): boolean {
  const RATE = RATES[kind];
  const key = `${kind}:${ip}`;
  const now = Date.now() / 1000;
  const b = buckets.get(key) ?? { tokens: RATE.capacity, last: now };
  b.tokens = Math.min(RATE.capacity, b.tokens + (now - b.last) * RATE.refillPerSec);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
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
/**
 * Is this a link to a specific module, or a name to search for?
 *
 * A bare word is a search: someone typing "disting" wants the list, not an
 * attempt to open modulargrid.net/e/disting. Only something carrying a path or
 * the host is treated as pointing at one particular module.
 */
export function looksLikeLink(raw: string): boolean {
  const v = raw.trim();
  return v.includes('/') || /modulargrid\.net/i.test(v);
}

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

/**
 * Turn a module's name into the slug ModularGrid would give it.
 *
 * Their addresses are simply the maker and the model, lower-cased and
 * hyphenated: "Make Noise Maths" is /e/make-noise-maths, "ALM Busy Circuits
 * Pamela's NEW Workout" is /e/alm-busy-circuits-pamelas-new-workout. That
 * makes a search engine unnecessary for the common case — the address can be
 * worked out from what was typed and tried directly, which costs one cached
 * request and no third party at all.
 *
 * It needs the maker as well as the model, since that is what the address
 * contains. When the guess misses, the caller offers a web search instead.
 */
export function slugFromName(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    // Apostrophes vanish rather than becoming separators: Pamela's is pamelas.
    .replace(/['\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z0-9][a-z0-9-]{2,120}$/.test(slug) ? slug : null;
}

/**
 * A web search narrowed to ModularGrid module pages.
 *
 * Offered when the address cannot be guessed. The search runs in the user's
 * own browser, on whatever engine they use, so there is no key to obtain and
 * nothing here pretending to be a person.
 */
export function searchUrl(query: string): string {
  const q = `site:modulargrid.net/e/ ${query.trim()}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
}

// --- finding a module by name ---

export interface MGMatch {
  slug: string;
  name: string;
}

/**
 * Searching without a search engine.
 *
 * Every search engine refuses this from a server: Google answers a plain
 * request with a "turn on JavaScript" page, DuckDuckGo returns its home page,
 * Bing and Mojeek block outright — and that is from a home connection, which
 * a deployment will not have. The paid APIs all want a key, which is a poor
 * trade for looking up a module name.
 *
 * ModularGrid publishes a sitemap, which is exactly a list of every page they
 * have and exists to be read by tools. Fetched once and held for a week, it
 * gives an index of every module that can be searched here, instantly, with no
 * third party involved — and it replaces what would otherwise be repeated
 * guessing against their servers.
 */
/**
 * Twice a day, twelve hours apart.
 *
 * Often enough that a module added this morning is findable this evening,
 * rarely enough to be a rounding error on someone else's bandwidth: two
 * fetches of a five megabyte file, against the hundreds of page requests the
 * same searching would otherwise cost them. Between fetches everything is
 * answered from here.
 */
const SITEMAP_TTL_MS = 12 * 60 * 60 * 1000;
const SITEMAP_TTL_SEC = SITEMAP_TTL_MS / 1000;
let indexCache: { slugs: string[]; at: number } | null = null;

async function moduleIndex(): Promise<string[]> {
  if (indexCache && Date.now() - indexCache.at < SITEMAP_TTL_MS) return indexCache.slugs;

  const res = await fetch(`${MG_BASE}/sitemaps.xml`, {
    headers: { 'User-Agent': UA, Accept: 'application/xml' },
    next: { revalidate: SITEMAP_TTL_SEC },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Could not read ModularGrid's index (${res.status})`);

  const xml = await res.text();
  const slugs: string[] = [];
  const re = /<loc>https:\/\/modulargrid\.net\/e\/([a-z0-9][a-z0-9-]*)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    // The sitemap lists the site's own sections alongside its modules.
    if (!SECTIONS.has(m[1].split('-')[0])) slugs.push(m[1]);
  }

  indexCache = { slugs, at: Date.now() };
  return slugs;
}

const SECTIONS = new Set([
  'modules', 'racks', 'users', 'forum', 'vendors', 'tags', 'pages', 'patches', 'offers', 'search',
]);

/**
 * Rank module addresses against what was typed.
 *
 * Addresses are the maker and the model hyphenated, so matching on those parts
 * is enough: "maths" finds make-noise-maths, and "disting" brings back every
 * disting there has been, which is the point — the user picks.
 */
export function rankModules(query: string, slugs: string[], limit = 12): MGMatch[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (terms.length === 0) return [];
  const joined = terms.join('-');

  const scored: Array<{ slug: string; score: number }> = [];
  for (const slug of slugs) {
    const parts = slug.split('-');
    let hits = 0;
    for (const t of terms) {
      if (parts.includes(t)) hits += 2;
      else if (parts.some((p) => p.startsWith(t))) hits += 1;
    }
    if (hits === 0) continue;

    let score = hits / (terms.length * 2);
    // The whole query appearing intact beats the same words scattered about.
    if (slug.includes(joined)) score += 0.6;
    if (slug === joined) score += 1;
    // Among equals prefer the shorter address, which is the plain module
    // rather than a longer variant of it.
    score -= 0.02 * Math.max(0, parts.length - terms.length);
    // Replacement faceplates are listed alongside the modules they replace and
    // share their names, so "bluebox" otherwise returns other people's panels
    // ahead of the module itself. They stay in the list, lower down.
    if (/(^|-)(panel|panels)(-|$)/.test(slug)) score -= 0.5;
    scored.push({ slug, score });
  }

  scored.sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);

  // The same module can appear under several addresses — an older entry, one
  // with a trailing hyphen — which all read back as the same name. Three
  // identical rows is a worse list than one, so only the best-ranked survives.
  const out: MGMatch[] = [];
  const seen = new Set<string>();
  for (const { slug } of scored) {
    const name = nameFromSlug(slug);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slug, name });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchModules(query: string, limit = 12): Promise<MGMatch[]> {
  return rankModules(query, await moduleIndex(), limit);
}

/** A readable name from an address, for the pick list. */
export function nameFromSlug(slug: string): string {
  return slug
    .replace(/-+$/, '')
    // ModularGrid writes an apostrophe as its own part: pamela-s -> Pamela's.
    .replace(/-s(?=-|$)/g, "'s")
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/ 's/g, "'s");
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
