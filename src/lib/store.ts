'use client';

import { create } from 'zustand';
import type { Font } from 'opentype.js';
import {
  COMPONENT_SPECS, PLACEABLE_KINDS, hpFromWidthMm, panelHeightMm, panelWidthMm,
  type FeatureKind, type PanelFormat, type SourceKind,
} from './eurorack';
import {
  DEFAULT_DETECT_SETTINGS, uid,
  type DecorElement, type DetectSettings, type Feature, type PanelDesign, type TextElement,
} from './types';
import { autoCrop, detectFeatures } from './cv/detect';
import {
  deleteDesign as dbDeleteDesign, loadDesigns, loadRack as dbLoadRack, migrateFromLocalStorage,
  putDesign, putDesigns, saveRack as dbSaveRack, stripForStorage, type SavedDesign,
} from './storage';
import {
  backupFilename, buildLibraryBackup, buildPanelBackup, buildRackBackup, mergeBackup,
  parseBackup, withNewIds, type Backup, type MergeReport,
} from './backup';
import {
  conflicts, defaultRack, emptyRow, firstFreeHp, touchRack,
  type Placement, type Rack, type RackRow,
} from './rack';
import type { Ring } from './geom/poly';
import { imageDataFromSource } from './cv/image';
import { loadFont } from './model/text';

export type ViewMode = '2d' | '3d' | 'rack';
export type InspectorTab = 'panel' | 'features' | 'decor' | 'export' | 'library';
/** null = select/move; a FeatureKind = click on the canvas to place one. */
export type Tool = null | FeatureKind;

export interface Crop { x: number; y: number; w: number; h: number }

interface State {
  design: PanelDesign;
  /** Original upload, kept at full resolution for re-detection after a re-crop. */
  sourceImage: ImageData | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  crop: Crop | null;
  detect: DetectSettings;
  detecting: boolean;
  mmPerPx: number | null;
  view: ViewMode;
  tab: InspectorTab;
  selectedIds: string[];
  tool: Tool;
  /** Drag/nudge snap pitch in mm. 0 is free movement. */
  gridMm: number;
  showSource: boolean;
  sourceOpacity: number;
  fonts: Map<string, Font>;
  fontVersion: number;
  error: string | null;

  /** Saved designs, and which one the editor is currently working on. */
  library: SavedDesign[];
  activeDesignId: string | null;
  designName: string;
  dirty: boolean;
  rack: Rack;

  /** What the last import did, for the UI to report. */
  lastImport: (MergeReport & { at: number }) | null;

  setDesign: (patch: Partial<PanelDesign>) => void;
  setSource: (img: ImageData, url: string, label: string, kind?: SourceKind) => void;
  clearSource: () => void;
  setCrop: (c: Crop) => void;
  setDetect: (patch: Partial<DetectSettings>) => void;
  runDetection: () => void;
  loadFromUrl: (url: string, label?: string, kind?: SourceKind) => Promise<void>;

  addFeature: (kind: FeatureKind, x: number, y: number) => void;
  updateFeature: (id: string, patch: Partial<Feature>) => void;
  removeFeatures: (ids: string[]) => void;
  duplicateFeatures: (ids: string[], offsetMm?: number) => string[];
  mirrorFeatures: (ids: string[], axis: 'x' | 'y') => void;
  distribute: (ids: string[], axis: 'x' | 'y') => void;
  alignFeatures: (ids: string[], edge: 'left' | 'right' | 'top' | 'bottom' | 'cx' | 'cy') => void;

  addDecor: (el: DecorElement) => void;
  updateDecor: (id: string, patch: Partial<DecorElement>) => void;
  removeDecor: (id: string) => void;
  duplicateDecor: (ids: string[], offsetMm?: number) => string[];
  /** Move a decor element to an absolute position; art translates its rings. */
  placeDecor: (id: string, x: number, y: number, originRings?: Ring[]) => void;

  loadLibraryFromStorage: () => Promise<void>;
  saveCurrentDesign: (name?: string) => void;
  openDesign: (id: string) => void;
  newDesign: () => void;
  deleteDesign: (id: string) => void;
  renameDesign: (id: string, name: string) => void;
  setDesignName: (name: string) => void;

  exportPanel: (id: string) => void;
  exportRack: () => void;
  exportEverything: () => void;
  importBackup: (text: string, opts?: { asCopy?: boolean }) => Promise<MergeReport>;

  setRack: (rack: Rack) => void;
  addRow: (widthHp?: number) => void;
  updateRow: (id: string, patch: Partial<RackRow>) => void;
  removeRow: (id: string) => void;
  addToRack: (designId: string, rowId?: string) => void;
  movePlacement: (placementId: string, toRowId: string, hp: number) => void;
  removePlacement: (placementId: string) => void;
  designWidthHp: (designId: string) => number;

  select: (ids: string[]) => void;
  setView: (v: ViewMode) => void;
  setTab: (t: InspectorTab) => void;
  setTool: (t: Tool) => void;
  setGrid: (mm: number) => void;
  setShowSource: (v: boolean) => void;
  setSourceOpacity: (v: number) => void;
  setError: (e: string | null) => void;
  ensureFont: (family: string, weight: number) => void;
}

export const DEFAULT_DESIGN: PanelDesign = {
  hp: 8,
  format: '3U',
  thicknessMm: 2,
  cornerRadiusMm: 1.5,
  backgroundColor: '#23262b',
  backgroundImageOpacity: 1,
  backgroundImageFit: 'cover',
  includeMountSlots: true,
  features: [],
  decor: [],
};

export const useStore = create<State>((set, get) => ({
  design: DEFAULT_DESIGN,
  sourceImage: null,
  sourceUrl: null,
  sourceLabel: null,
  crop: null,
  detect: DEFAULT_DETECT_SETTINGS,
  detecting: false,
  mmPerPx: null,
  view: '2d',
  tab: 'panel',
  selectedIds: [],
  tool: null,
  gridMm: 0,
  showSource: true,
  sourceOpacity: 0.55,
  fonts: new Map(),
  fontVersion: 0,
  error: null,
  library: [],
  activeDesignId: null,
  designName: 'Untitled panel',
  dirty: false,
  rack: defaultRack(),
  lastImport: null,

  setDesign: (patch) => set((s) => ({ design: { ...s.design, ...patch }, dirty: true })),

  setSource: (img, url, label, kind) => {
    const crop = autoCrop(img);
    // Guess HP from the crop's aspect ratio: panel height is fixed by format,
    // so the width in millimetres follows, and HP is that over the 5.08 pitch.
    const { format } = get().design;
    const guessedWidth = (crop.w / crop.h) * panelHeightMm(format);
    const hp = Math.max(1, Math.min(120, hpFromWidthMm(guessedWidth)));
    set((s) => ({
      sourceImage: img,
      sourceUrl: url,
      sourceLabel: label,
      crop,
      error: null,
      design: { ...s.design, hp },
      detect: kind ? { ...s.detect, sourceKind: kind } : s.detect,
    }));
    get().runDetection();
  },

  clearSource: () =>
    set({ sourceImage: null, sourceUrl: null, sourceLabel: null, crop: null, mmPerPx: null }),

  setCrop: (crop) => set({ crop }),

  setDetect: (patch) => set((s) => ({ detect: { ...s.detect, ...patch } })),

  runDetection: () => {
    const { sourceImage, crop, design, detect } = get();
    if (!sourceImage) return;
    set({ detecting: true });
    // Yield a frame so the spinner paints before the main thread blocks.
    setTimeout(() => {
      try {
        const res = detectFeatures({
          image: sourceImage,
          hp: design.hp,
          format: design.format,
          crop: crop ?? undefined,
          settings: detect,
        });
        set((s) => ({
          // Hand-placed and locked features survive a re-detect; only
          // previously auto-detected ones are replaced.
          design: {
            ...s.design,
            features: [...s.design.features.filter((f) => f.locked), ...res.features],
          },
          mmPerPx: res.mmPerPx,
          detecting: false,
          selectedIds: [],
        }));
      } catch (e) {
        set({ detecting: false, error: e instanceof Error ? e.message : 'Detection failed' });
      }
    }, 16);
  },

  loadFromUrl: async (url, label, kind) => {
    try {
      set({ error: null });
      // Remote images need the proxy for CORS; data URLs and blobs do not.
      const src = url.startsWith('data:') || url.startsWith('blob:')
        ? url
        : `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const img = await imageDataFromSource(src);
      get().setSource(img, src, label ?? 'Image', kind);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not load that image' });
    }
  },

  addFeature: (kind, x, y) => {
    const spec = COMPONENT_SPECS[kind];
    const f: Feature = {
      id: uid(),
      kind,
      x,
      y,
      shape: spec.shape,
      d: spec.holeMm || 5,
      len: spec.shape === 'slot' ? spec.slotLengthMm ?? 40 : spec.shape === 'rect' ? 20 : undefined,
      radius: spec.shape === 'rect' ? 1 : undefined,
      rotation: 0,
      locked: true, // hand-placed, so a re-detect must not wipe it
    };
    set((s) => ({ design: { ...s.design, features: [...s.design.features, f] }, selectedIds: [f.id] }));
  },

  updateFeature: (id, patch) =>
    set((s) => ({
      design: {
        ...s.design,
        features: s.design.features.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      },
    })),

  removeFeatures: (ids) =>
    set((s) => ({
      design: { ...s.design, features: s.design.features.filter((f) => !ids.includes(f.id)) },
      selectedIds: [],
    })),

  /**
   * Copy features and select the copies.
   *
   * Returns the new ids so a caller can keep dragging them, which is what
   * alt-drag on the canvas does: it duplicates in place with no offset and
   * hands the drag over to the copy.
   */
  duplicateFeatures: (ids, offsetMm = 3) => {
    const copies = get().design.features
      .filter((f) => ids.includes(f.id))
      .map((f) => ({ ...f, id: uid(), x: f.x + offsetMm, y: f.y + offsetMm, locked: true }));
    if (copies.length === 0) return [];
    set((s) => ({
      design: { ...s.design, features: [...s.design.features, ...copies] },
      selectedIds: copies.map((c) => c.id),
      dirty: true,
    }));
    return copies.map((c) => c.id);
  },

  mirrorFeatures: (ids, axis) =>
    set((s) => {
      const W = panelWidthMm(s.design.hp);
      const H = panelHeightMm(s.design.format);
      return {
        design: {
          ...s.design,
          features: s.design.features.map((f) =>
            ids.includes(f.id)
              ? axis === 'x'
                ? { ...f, x: W - f.x }
                : { ...f, y: H - f.y }
              : f,
          ),
        },
      };
    }),

  /** Even out the gaps between three or more features along one axis. */
  distribute: (ids, axis) =>
    set((s) => {
      const picked = s.design.features.filter((f) => ids.includes(f.id));
      if (picked.length < 3) return {};
      const key = axis === 'x' ? 'x' : 'y';
      const sorted = [...picked].sort((a, b) => a[key] - b[key]);
      const first = sorted[0][key];
      const last = sorted[sorted.length - 1][key];
      const step = (last - first) / (sorted.length - 1);
      const moved = new Map(sorted.map((f, i) => [f.id, first + step * i]));
      return {
        design: {
          ...s.design,
          features: s.design.features.map((f) =>
            moved.has(f.id) ? { ...f, [key]: round2(moved.get(f.id)!) } : f,
          ),
        },
      };
    }),

  alignFeatures: (ids, edge) =>
    set((s) => {
      const picked = s.design.features.filter((f) => ids.includes(f.id));
      if (picked.length < 2) return {};
      const xs = picked.map((f) => f.x);
      const ys = picked.map((f) => f.y);
      const target =
        edge === 'left' ? Math.min(...xs)
        : edge === 'right' ? Math.max(...xs)
        : edge === 'top' ? Math.min(...ys)
        : edge === 'bottom' ? Math.max(...ys)
        : edge === 'cx' ? xs.reduce((a, b) => a + b, 0) / xs.length
        : ys.reduce((a, b) => a + b, 0) / ys.length;
      const axis = edge === 'left' || edge === 'right' || edge === 'cx' ? 'x' : 'y';
      return {
        design: {
          ...s.design,
          features: s.design.features.map((f) =>
            ids.includes(f.id) ? { ...f, [axis]: round2(target) } : f,
          ),
        },
      };
    }),

  addDecor: (el) =>
    set((s) => ({ design: { ...s.design, decor: [...s.design.decor, el] }, selectedIds: [el.id] })),

  updateDecor: (id, patch) =>
    set((s) => ({
      design: {
        ...s.design,
        decor: s.design.decor.map((d) => (d.id === id ? ({ ...d, ...patch } as DecorElement) : d)),
      },
    })),

  removeDecor: (id) =>
    set((s) => ({
      design: { ...s.design, decor: s.design.decor.filter((d) => d.id !== id) },
      selectedIds: [],
    })),

  duplicateDecor: (ids, offsetMm = 3) => {
    const copies = get().design.decor
      .filter((d) => ids.includes(d.id))
      .map((d) => {
        const base = { ...d, id: uid(d.type[0]) } as DecorElement;
        if (base.type === 'art') {
          // Art carries absolute rings rather than an anchor, so a copy has to
          // be translated point by point.
          return {
            ...base,
            rings: base.rings.map((r) => r.map((p) => ({ x: p.x + offsetMm, y: p.y + offsetMm }))),
          } as DecorElement;
        }
        return { ...base, x: base.x + offsetMm, y: base.y + offsetMm } as DecorElement;
      });
    if (copies.length === 0) return [];
    set((s) => ({
      design: { ...s.design, decor: [...s.design.decor, ...copies] },
      selectedIds: copies.map((c) => c.id),
      dirty: true,
    }));
    return copies.map((c) => c.id);
  },

  placeDecor: (id, x, y, originRings) =>
    set((s) => ({
      dirty: true,
      design: {
        ...s.design,
        decor: s.design.decor.map((d) => {
          if (d.id !== id) return d;
          if (d.type !== 'art') return { ...d, x, y } as DecorElement;
          // For art, x and y are a delta rather than an anchor: the rings are
          // translated from the positions they had when the drag began.
          const src = originRings ?? d.rings;
          return { ...d, rings: src.map((r) => r.map((p) => ({ x: p.x + x, y: p.y + y }))) };
        }),
      },
    })),

  // --- library ---

  loadLibraryFromStorage: async () => {
    // Anything left by the localStorage era moves across once, then stays put.
    await migrateFromLocalStorage();
    const [library, rack] = await Promise.all([loadDesigns(), dbLoadRack()]);
    set({ library, rack: rack ?? defaultRack() });
  },

  saveCurrentDesign: (name) => {
    const { library, design, designName, activeDesignId } = get();
    const entry: SavedDesign = {
      id: activeDesignId ?? uid('d'),
      name: (name ?? designName).trim() || 'Untitled panel',
      updatedAt: Date.now(),
      design: stripForStorage(design),
    };
    const items = [entry, ...library.filter((i) => i.id !== entry.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt);

    set({ library: items, activeDesignId: entry.id, designName: entry.name, dirty: false });
    void putDesign(entry).catch(() =>
      set({ error: 'Could not save — the browser refused to write to local storage.' }),
    );
  },

  openDesign: (id) => {
    const found = get().library.find((i) => i.id === id);
    if (!found) return;
    set({
      design: found.design,
      activeDesignId: id,
      designName: found.name,
      dirty: false,
      selectedIds: [],
      // The reference photo is not saved with a design, so clear it rather
      // than leaving another panel's picture underneath this one.
      sourceImage: null,
      sourceUrl: null,
      sourceLabel: null,
      crop: null,
      mmPerPx: null,
      view: '2d',
    });
  },

  newDesign: () =>
    set({
      design: DEFAULT_DESIGN,
      activeDesignId: null,
      designName: 'Untitled panel',
      dirty: false,
      selectedIds: [],
      sourceImage: null,
      sourceUrl: null,
      sourceLabel: null,
      crop: null,
      mmPerPx: null,
      view: '2d',
    }),

  deleteDesign: (id) => {
    const items = get().library.filter((i) => i.id !== id);
    // Take it out of the rack too, or the rack would point at nothing.
    const rack = touchRack({
      ...get().rack,
      rows: get().rack.rows.map((r) => ({
        ...r,
        placements: r.placements.filter((p) => p.designId !== id),
      })),
    });
    set((st) => ({
      library: items,
      rack,
      activeDesignId: st.activeDesignId === id ? null : st.activeDesignId,
    }));
    void dbDeleteDesign(id);
    void dbSaveRack(rack);
  },

  renameDesign: (id, name) => {
    const found = get().library.find((i) => i.id === id);
    if (!found) return;
    const entry: SavedDesign = { ...found, name: name.trim() || found.name, updatedAt: Date.now() };
    set((st) => ({
      library: st.library.map((i) => (i.id === id ? entry : i)),
      designName: st.activeDesignId === id ? entry.name : st.designName,
    }));
    void putDesign(entry);
  },

  setDesignName: (designName) => set({ designName, dirty: true }),

  // --- export and import ---

  exportPanel: (id) => {
    const found = get().library.find((i) => i.id === id);
    if (!found) return;
    downloadJson(buildPanelBackup(found), backupFilename('panel', found.name));
  },

  exportRack: () => {
    const { rack, library } = get();
    downloadJson(buildRackBackup(rack, library), backupFilename('rack', rack.name));
  },

  exportEverything: () => {
    const { rack, library } = get();
    downloadJson(buildLibraryBackup(library, rack), backupFilename('library'));
  },

  /**
   * Read a file back in.
   *
   * Merges rather than replaces: panels match by id and the newer edit wins, so
   * re-importing a backup restores instead of duplicating. Nothing is removed —
   * a file that leaves a panel out is not a request to delete it.
   */
  importBackup: async (text, opts = {}) => {
    const { backup } = parseBackup(text);
    const payload: Backup = opts.asCopy ? withNewIds(backup) : backup;

    // A rack file brings a rack with it; a single panel plainly should not
    // rearrange the one you have.
    const replaceRack = Boolean(payload.rack) && payload.kind !== 'panel';
    const merged = mergeBackup(get().library, payload, { replaceRack });

    set((st) => ({
      library: merged.library,
      rack: merged.rack ?? st.rack,
      lastImport: { ...merged.report, at: Date.now() },
      error: null,
    }));

    await putDesigns(payload.panels.map((d) => ({ ...d, design: stripForStorage(d.design) })));
    if (merged.rack) await dbSaveRack(merged.rack);
    return merged.report;
  },

  // --- rack ---

  designWidthHp: (designId) => get().library.find((i) => i.id === designId)?.design.hp ?? 0,

  setRack: (rack) => { const r = touchRack(rack); set({ rack: r }); void dbSaveRack(r); },

  addRow: (widthHp) => {
    const last = get().rack.rows[get().rack.rows.length - 1];
    const rack = touchRack({
      ...get().rack,
      rows: [...get().rack.rows, emptyRow(widthHp ?? last?.widthHp ?? 84, last?.format ?? '3U')],
    });
    void dbSaveRack(rack);
    set({ rack });
  },

  updateRow: (id, patch) => {
    const rack = touchRack({
      ...get().rack,
      rows: get().rack.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
    void dbSaveRack(rack);
    set({ rack });
  },

  removeRow: (id) => {
    const rack = touchRack({ ...get().rack, rows: get().rack.rows.filter((r) => r.id !== id) });
    void dbSaveRack(rack);
    set({ rack });
  },

  addToRack: (designId, rowId) => {
    const { rack, designWidthHp } = get();
    const width = designWidthHp(designId);
    if (width <= 0) return;

    // Try the named row first, then any row with space, so a click on a
    // library panel always lands somewhere sensible.
    const order = rowId
      ? [rack.rows.find((r) => r.id === rowId), ...rack.rows.filter((r) => r.id !== rowId)]
      : rack.rows;

    for (const row of order) {
      if (!row) continue;
      const hp = firstFreeHp(row, width, designWidthHp);
      if (hp === null) continue;
      const placement: Placement = { id: uid('p'), designId, hp };
      const next = touchRack({
        ...rack,
        rows: rack.rows.map((r) =>
          r.id === row.id ? { ...r, placements: [...r.placements, placement] } : r,
        ),
      });
      void dbSaveRack(next);
      set({ rack: next });
        return;
    }
    set({ error: `No room for a ${width} HP panel. Add a row, or make one wider.` });
  },

  movePlacement: (placementId, toRowId, hp) => {
    const { rack } = get();
    let moved: Placement | null = null;
    const stripped = rack.rows.map((r) => ({
      ...r,
      placements: r.placements.filter((p) => {
        if (p.id !== placementId) return true;
        moved = p;
        return false;
      }),
    }));
    if (!moved) return;
    const placed: Placement = { ...(moved as Placement), hp: Math.max(0, Math.round(hp)) };
    const next = touchRack({
      ...rack,
      rows: stripped.map((r) => (r.id === toRowId ? { ...r, placements: [...r.placements, placed] } : r)),
    });
    void dbSaveRack(next);
    set({ rack: next });
  },

  removePlacement: (placementId) => {
    const rack = touchRack({
      ...get().rack,
      rows: get().rack.rows.map((r) => ({
        ...r,
        placements: r.placements.filter((p) => p.id !== placementId),
      })),
    });
    void dbSaveRack(rack);
    set({ rack });
  },

  select: (ids) => set({ selectedIds: ids }),
  setView: (view) => set({ view }),
  setTab: (tab) => set({ tab }),
  setTool: (tool) => set({ tool }),
  setGrid: (gridMm) => set({ gridMm }),
  setShowSource: (showSource) => set({ showSource }),
  setSourceOpacity: (sourceOpacity) => set({ sourceOpacity }),
  setError: (error) => set({ error }),

  ensureFont: (family, weight) => {
    const key = `${family}@${weight}`;
    if (get().fonts.has(key)) return;
    loadFont(family, weight)
      .then((font) => {
        set((s) => {
          const fonts = new Map(s.fonts);
          fonts.set(key, font);
          return { fonts, fontVersion: s.fontVersion + 1 };
        });
      })
      .catch((e) => set({ error: e instanceof Error ? e.message : `Could not load ${family}` }));
  },
}));

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Hand a JSON file to the browser as a download. */
function downloadJson(data: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Convenience selectors used across the UI. */
export const selectPanelSize = (s: State) => ({
  w: panelWidthMm(s.design.hp),
  h: panelHeightMm(s.design.format),
});

export { PLACEABLE_KINDS, COMPONENT_SPECS, conflicts };
export type { FeatureKind, PanelFormat, SourceKind };
