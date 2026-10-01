'use client';

import { migrateDesign, type Crop, type PanelDesign, type Session } from './types';
import type { Rack } from './rack';

/**
 * Where designs and racks live.
 *
 * IndexedDB rather than localStorage. localStorage caps out around 5 MB across
 * the whole origin, and a single panel with traced artwork can carry thousands
 * of points, so a modest library reaches the limit and saves start failing.
 * IndexedDB has room to spare and stores structured values directly instead of
 * re-serialising the entire library on every keystroke.
 *
 * Anything already in localStorage from an earlier version is moved across on
 * first load, then left alone.
 */

/**
 * The database keeps its original name on purpose.
 *
 * It holds every panel anyone has saved. Renaming it when the app was renamed
 * would not migrate that work, it would orphan it — the old database would sit
 * there, full, while the app looked in an empty new one.
 */
const DB_NAME = 'eurorack-panel-generator';
const DB_VERSION = 1;
const DESIGNS = 'designs';
const META = 'meta';
const RACK_KEY = 'rack';
const SESSION_KEY = 'session';
const FONTS_KEY = 'fonts';

const LEGACY_LIBRARY = 'eurorack-panel-generator/library/v1';
const LEGACY_RACK = 'eurorack-panel-generator/rack/v1';

export interface SavedDesign {
  id: string;
  name: string;
  /** Epoch milliseconds. */
  updatedAt: number;
  design: PanelDesign;
  /**
   * Where the reference photo came from, so reopening the design can put it
   * back under the panel.
   *
   * The address rather than the picture: a module render is a megabyte or two,
   * and a library of them would be storing the same bytes the browser's own
   * HTTP cache already holds. Only addresses that can be fetched again are
   * kept — a blob: URL from a file the user dragged in dies with the page, so
   * there is nothing worth writing down.
   */
  reference?: SourceReference;
}

export interface SourceReference {
  url: string;
  label: string;
  /** The crop the detection was run against, in source-image pixels. */
  crop: Crop;
  /** Width the module's own page stated, kept as the figure to compare against. */
  hp?: number;
}

/** Is this an address that will still work in a later session? */
export function isRefetchable(url: string | null): boolean {
  return !!url && !url.startsWith('blob:') && !url.startsWith('data:');
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DESIGNS)) db.createObjectStore(DESIGNS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database'));
  });
  // A failed open should not be cached, or every later call fails too.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Local database write failed'));
      }),
  );
}

export async function loadDesigns(): Promise<SavedDesign[]> {
  try {
    const all = await tx<SavedDesign[]>(DESIGNS, 'readonly', (s) => s.getAll() as IDBRequest<SavedDesign[]>);
    return all
      .filter(isSaved)
      // Designs saved before the cutout shapes were collapsed are converted on
      // the way in, so an old library keeps working.
      .map((d) => ({ ...d, design: migrateDesign(d.design) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function putDesign(design: SavedDesign): Promise<void> {
  await tx(DESIGNS, 'readwrite', (s) => s.put(design));
}

export async function putDesigns(designs: SavedDesign[]): Promise<void> {
  if (designs.length === 0) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(DESIGNS, 'readwrite');
    const store = t.objectStore(DESIGNS);
    for (const d of designs) store.put(d);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('Local database write failed'));
  });
}

export async function deleteDesign(id: string): Promise<void> {
  await tx(DESIGNS, 'readwrite', (s) => s.delete(id));
}

export async function loadRack(): Promise<Rack | null> {
  try {
    const r = await tx<Rack | undefined>(META, 'readonly', (s) => s.get(RACK_KEY) as IDBRequest<Rack | undefined>);
    return r && Array.isArray(r.rows) ? r : null;
  } catch {
    return null;
  }
}

export async function saveRack(rack: Rack): Promise<void> {
  await tx(META, 'readwrite', (s) => s.put(rack, RACK_KEY));
}

/**
 * A font file the user uploaded, kept so lettering set in it survives a reload.
 *
 * Fonts are told apart by what is in the file, not by what it was called: the
 * same font uploaded twice, or brought back by a backup under another name, is
 * one font. The hash is how that is recognised.
 */
export interface StoredFont {
  family: string;
  data: ArrayBuffer;
  /** SHA-256 of `data`, lowercase hex. */
  hash: string;
}

export async function hashFont(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Every stored font, each with its hash.
 *
 * Fonts stored before the hash existed are given one here and written back,
 * so the next load does not have to work it out again.
 */
export async function loadFontFiles(): Promise<StoredFont[]> {
  let all: Array<Partial<StoredFont>>;
  try {
    const raw = await tx<Array<Partial<StoredFont>> | undefined>(META, 'readonly', (s) =>
      s.get(FONTS_KEY) as IDBRequest<Array<Partial<StoredFont>> | undefined>);
    all = Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }

  const fonts: StoredFont[] = [];
  let backfilled = false;
  for (const f of all) {
    if (typeof f?.family !== 'string' || !(f.data instanceof ArrayBuffer)) continue;
    let hash = f.hash;
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      hash = await hashFont(f.data);
      backfilled = true;
    }
    fonts.push({ family: f.family, data: f.data, hash });
  }
  if (backfilled) {
    try {
      await tx(META, 'readwrite', (s) => s.put(fonts, FONTS_KEY));
    } catch {
      // Worked out again next time; nothing is lost by failing here.
    }
  }
  return fonts;
}

/** Store a font under its family name, replacing any entry by that name. */
export async function putFontFile(font: Omit<StoredFont, 'hash'> & { hash?: string }): Promise<StoredFont> {
  const stored: StoredFont = { ...font, hash: font.hash ?? (await hashFont(font.data)) };
  const rest = (await loadFontFiles()).filter((f) => f.family !== font.family);
  await tx(META, 'readwrite', (s) => s.put([...rest, stored], FONTS_KEY));
  return stored;
}

/**
 * The work in progress.
 *
 * Written continuously rather than on demand, so a refresh, a crash or a
 * closed tab costs nothing. Failures are swallowed: a browser with storage
 * blocked should still run the app, it just will not remember.
 */
export async function loadSession(): Promise<Session | null> {
  try {
    const s = await tx<Session | undefined>(META, 'readonly', (st) =>
      st.get(SESSION_KEY) as IDBRequest<Session | undefined>);
    if (!s || !s.design || !Array.isArray(s.design.features)) return null;
    return { ...s, design: migrateDesign(s.design) };
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    await tx(META, 'readwrite', (st) => st.put(session, SESSION_KEY));
  } catch {
    // Quota, private browsing, or storage switched off entirely.
  }
}

export async function clearSession(): Promise<void> {
  try {
    await tx(META, 'readwrite', (st) => st.delete(SESSION_KEY));
  } catch {
    // Nothing to do; the next save will overwrite it anyway.
  }
}

/**
 * Move anything left in localStorage into IndexedDB.
 *
 * Runs once. The old keys are cleared only after the new copy is written, so
 * an interruption leaves the originals to try again rather than nothing at all.
 */
export async function migrateFromLocalStorage(): Promise<number> {
  let moved = 0;
  try {
    const rawLib = localStorage.getItem(LEGACY_LIBRARY);
    if (rawLib) {
      const parsed: unknown = JSON.parse(rawLib);
      if (Array.isArray(parsed)) {
        const designs = parsed
          .filter(isSaved)
          .map((d) => ({ ...d, design: migrateDesign(d.design) }));
        await putDesigns(designs);
        moved = designs.length;
      }
      localStorage.removeItem(LEGACY_LIBRARY);
    }

    const rawRack = localStorage.getItem(LEGACY_RACK);
    if (rawRack) {
      const parsed = JSON.parse(rawRack) as Rack;
      if (parsed && Array.isArray(parsed.rows)) await saveRack(parsed);
      localStorage.removeItem(LEGACY_RACK);
    }

    // Tombstones only ever existed to tell a server about deletions.
    localStorage.removeItem('eurorack-panel-generator/tombstones/v1');
  } catch {
    // A browser with storage blocked still runs; it just will not remember.
  }
  return moved;
}

/** How much room is left, when the browser will say. */
export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.usage === undefined || e.quota === undefined) return null;
    return { usedMb: e.usage / 1024 / 1024, quotaMb: e.quota / 1024 / 1024 };
  } catch {
    return null;
  }
}

export function isSaved(v: unknown): v is SavedDesign {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<SavedDesign>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.updatedAt === 'number' &&
    !!o.design &&
    typeof o.design === 'object' &&
    typeof (o.design as PanelDesign).hp === 'number' &&
    Array.isArray((o.design as PanelDesign).features)
  );
}

