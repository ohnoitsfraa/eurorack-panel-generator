'use client';

import { create } from 'zustand';
import type { Font } from 'opentype.js';
import {
  COMPONENT_SPECS, CUTOUT_PRESETS, HOLE_CLEARANCE, STANDARD_KINDS,
  hpFromWidthMm, panelHeightMm, panelWidthMm,
  type CutoutShapeId, type FeatureKind, type PanelFormat, type SourceKind,
} from './eurorack';
import {
  DEFAULT_DETECT_SETTINGS, uid,
  type Crop, type DecorElement, type DetectSettings, type Feature, type PanelDesign,
  type Session, type TextElement,
} from './types';
import { autoCrop, detectFeatures } from './cv/detect';
import {
  clearSession, deleteDesign as dbDeleteDesign, loadDesigns, loadRack as dbLoadRack,
  loadSession, migrateFromLocalStorage, putDesign, putDesigns, saveRack as dbSaveRack,
  hashFont, isRefetchable, loadFontFiles, putFontFile, saveSession, type SavedDesign, type SourceReference,
} from './storage';
import {
  base64ToBytes, backupFilename, buildLibraryBackup, buildPanelBackup, buildRackBackup, mergeBackup,
  parseBackup, renameFontFamilies, withNewIds, type Backup, type MergeReport,
} from './backup';
import {
  conflicts, defaultRack, emptyRow, firstFreeHp, touchRack,
  type Placement, type Rack, type RackRow,
} from './rack';
import type { Ring } from './geom/poly';
import {
  applyTheme, readChoice, writeChoice, type ResolvedTheme, type ThemeChoice,
} from './theme';
import { fetchImage, imageDataFromBlob } from './cv/image';
import { fontsUsedBy, loadFont, registerFont } from './model/text';
import { uploadedFontName } from './fonts';

export type ViewMode = '2d' | '3d' | 'rack';
export type InspectorTab = 'panel' | 'features' | 'decor' | 'export' | 'library';
/** null = select/move; otherwise the shape the next canvas click will place. */
export type Tool = null | CutoutShapeId;

export type { Crop } from './types';

interface State {
  design: PanelDesign;
  /**
   * The design as last saved, opened or started, by identity.
   *
   * Every edit replaces the design object, so "has this been changed" is a
   * comparison of references against this one rather than something each
   * action has to remember to declare. See the subscription at the foot of
   * this file.
   */
  savedDesign: PanelDesign;
  /** Previous states of the panel, oldest first, and the ones undone. */
  past: Snapshot[];
  future: Snapshot[];
  /** Original upload, kept at full resolution for re-detection after a re-crop. */
  sourceImage: ImageData | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  /** Width the module's page stated, kept to compare the panel against. */
  sourceHp: number | null;
  /** The picture as it arrived, so it can be stored and restored intact. */
  sourceBlob: Blob | null;
  crop: Crop | null;
  detect: DetectSettings;
  detecting: boolean;
  mmPerPx: number | null;
  /** Marks the last detection discarded as printing rather than hardware. */
  droppedAsMarkings: number;
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
  /** Families the user uploaded, offered in the font list after the built-in ones. */
  customFonts: string[];
  error: string | null;

  /** Saved designs, and which one the editor is currently working on. */
  library: SavedDesign[];
  activeDesignId: string | null;
  designName: string;
  dirty: boolean;
  rack: Rack;

  /** What the last import did, for the UI to report. */
  lastImport: (MergeReport & { at: number }) | null;
  /** False until the saved session has been read back, if there is one. */
  hydrated: boolean;
  /** Set when a refresh restored unsaved work, so the UI can say so. */
  restoredAt: number | null;
  theme: ThemeChoice;
  /** What `theme` currently works out to, for the parts that cannot read CSS. */
  resolvedTheme: ResolvedTheme;

  setDesign: (patch: Partial<PanelDesign>) => void;
  setSource: (img: ImageData, url: string, label: string, kind?: SourceKind, knownHp?: number, blob?: Blob | null) => void;
  clearSource: () => void;
  setCrop: (c: Crop) => void;
  setDetect: (patch: Partial<DetectSettings>) => void;
  runDetection: () => void;
  loadFromUrl: (url: string, label?: string, kind?: SourceKind, knownHp?: number) => Promise<void>;

  addFeature: (shape: CutoutShapeId, x: number, y: number) => void;
  updateFeature: (id: string, patch: Partial<Feature>) => void;
  /** Change several cutouts, each by its own patch, as one step for undo. */
  updateFeatures: (ids: string[], patch: (f: Feature) => Partial<Feature>) => void;
  removeFeatures: (ids: string[]) => void;
  duplicateFeatures: (ids: string[], offsetMm?: number) => string[];
  mirrorFeatures: (ids: string[], axis: 'x' | 'y') => void;
  distribute: (ids: string[], axis: 'x' | 'y') => void;
  alignFeatures: (ids: string[], edge: 'left' | 'right' | 'top' | 'bottom' | 'cx' | 'cy') => void;

  addDecor: (el: DecorElement) => void;
  /** A label at the top of the panel, ready to be typed into. */
  addTextLabel: () => string;
  /** A plain rule across the panel, the starting point for drawn decor. */
  addShapeElement: () => string;
  updateDecor: (id: string, patch: Partial<DecorElement>) => void;
  /** The same change to several elements, as one step for undo. */
  updateDecorMany: (ids: string[], patch: Partial<DecorElement>) => void;
  removeDecor: (id: string) => void;
  duplicateDecor: (ids: string[], offsetMm?: number) => string[];
  /** Move a decor element to an absolute position; art translates its rings. */
  placeDecor: (id: string, x: number, y: number) => void;

  loadLibraryFromStorage: () => Promise<void>;
  discardRestored: () => void;
  setTheme: (choice: ThemeChoice) => void;
  /** Re-resolve after the system preference changes underneath a 'system' choice. */
  syncTheme: () => void;
  saveCurrentDesign: (name?: string) => void;
  openDesign: (id: string) => void;
  undo: () => void;
  redo: () => void;
  restoreReference: (designId: string, ref: SourceReference) => Promise<void>;
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
  /** Returns false when there is nowhere for the panel to go. */
  addToRack: (designId: string, rowId?: string) => boolean;
  movePlacement: (placementId: string, toRowId: string, hp: number) => void;
  removePlacement: (placementId: string) => void;
  /** Take every panel out of the rack, leaving the rows. */
  emptyRack: () => void;
  /** Remove every saved panel, the rack, and the panel being edited. */
  clearEverything: () => Promise<void>;
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
  /** Read, register and keep a font file. Resolves to its family, or null if it is not a font. */
  addCustomFont: (file: File) => Promise<string | null>;
}

/** A panel as it stood, for stepping back to. */
export interface Snapshot {
  design: PanelDesign;
  designName: string;
}

/** Set while undo or redo is applying, so the step is not itself recorded. */
let restoring = false;

/**
 * Edits closer together than this are one step.
 *
 * A drag writes a new position on every pointer move, and typing into a label
 * writes a new string on every key; without this, undo would walk back through
 * a drag one pixel at a time. The first write in a burst is the one kept,
 * which is the state before the gesture started — what "undo that" means.
 */
const COALESCE_MS = 450;
const HISTORY_LIMIT = 100;
let lastPushAt = 0;

export const DEFAULT_DESIGN: PanelDesign = {
  hp: 8,
  format: '3U',
  thicknessMm: 2,
  cornerRadiusMm: 1.5,
  backgroundColor: '#e8e6df',   // Brushed Alu, so a new panel starts on-brand
  includeMountSlots: true,
  holeClearanceMm: HOLE_CLEARANCE.default,
  features: [],
  decor: [],
};

export const useStore = create<State>((set, get) => ({
  design: DEFAULT_DESIGN,
  savedDesign: DEFAULT_DESIGN,
  past: [],
  future: [],
  sourceImage: null,
  sourceUrl: null,
  sourceLabel: null,
  sourceHp: null,
  sourceBlob: null,
  crop: null,
  detect: DEFAULT_DETECT_SETTINGS,
  detecting: false,
  mmPerPx: null,
  droppedAsMarkings: 0,
  view: '2d',
  tab: 'panel',
  selectedIds: [],
  tool: null,
  gridMm: 0,
  showSource: true,
  sourceOpacity: 0.55,
  fonts: new Map(),
  fontVersion: 0,
  customFonts: [],
  error: null,
  library: [],
  activeDesignId: null,
  designName: 'Untitled panel',
  dirty: false,
  rack: defaultRack(),
  lastImport: null,
  hydrated: false,
  restoredAt: null,
  theme: 'system',
  resolvedTheme: 'dark',

  setDesign: (patch) => set((s) => ({ design: { ...s.design, ...patch } })),

  setSource: (img, url, label, kind, knownHp, blob) => {
    const crop = autoCrop(img);
    // Guess HP from the crop's aspect ratio: panel height is fixed by format,
    // so the width in millimetres follows, and HP is that over the 5.08 pitch.
    //
    // Only a guess, though. When the width is actually known — ModularGrid
    // states it on the module's page — that is used instead. A render is often
    // padded by a pixel or two, which is enough to land a 30 HP module on 29,
    // and being one pitch out misplaces every hole on the panel.
    const { format } = get().design;
    const guessedWidth = (crop.w / crop.h) * panelHeightMm(format);
    const hp = knownHp && knownHp > 0
      ? Math.round(knownHp)
      : Math.max(1, Math.min(120, hpFromWidthMm(guessedWidth)));
    set((s) => ({
      sourceImage: img,
      sourceUrl: url,
      sourceLabel: label,
      sourceHp: knownHp && knownHp > 0 ? Math.round(knownHp) : null,
      sourceBlob: blob ?? null,
      crop,
      error: null,
      design: { ...s.design, hp },
      detect: kind ? { ...s.detect, sourceKind: kind } : s.detect,
      // Name the panel after the module it came from, so it does not have to
      // be typed out. A panel already saved under its own name keeps it: at
      // that point the picture is a reference for existing work, not the
      // subject of it.
      designName: nameFor(s, label),
    }));
    get().runDetection();
  },

  clearSource: () =>
    set({
      sourceImage: null, sourceUrl: null, sourceLabel: null, sourceHp: null, sourceBlob: null,
      crop: null, mmPerPx: null, droppedAsMarkings: 0,
    }),

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
          droppedAsMarkings: res.droppedAsMarkings ?? 0,
          detecting: false,
          selectedIds: [],
        }));
      } catch (e) {
        set({ detecting: false, error: e instanceof Error ? e.message : 'Detection failed' });
      }
    }, 16);
  },

  loadFromUrl: async (url, label, kind, knownHp) => {
    try {
      set({ error: null });
      // Remote images need the proxy for CORS; data URLs and blobs do not.
      const src = url.startsWith('data:') || url.startsWith('blob:')
        ? url
        : `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const { blob, image } = await fetchImage(src);
      get().setSource(image, src, label ?? 'Image', kind, knownHp, blob);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not load that image' });
    }
  },

  addFeature: (shape, x, y) => {
    const preset = CUTOUT_PRESETS.find((p) => p.id === shape) ?? CUTOUT_PRESETS[0];
    const f: Feature = {
      id: uid(),
      // Hand-placed cutouts start as plain shapes. Naming the component is a
      // separate step, taken from the standard sizes once it is placed.
      kind: 'custom',
      x,
      y,
      shape: preset.shape,
      w: preset.w,
      h: preset.h,
      radius: preset.radius,
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

  updateFeatures: (ids, patch) =>
    set((s) => {
      const which = new Set(ids);
      return {
        design: {
          ...s.design,
          features: s.design.features.map((f) => (which.has(f.id) ? { ...f, ...patch(f) } : f)),
        },
      };
    }),

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

  addTextLabel: () => {
    const { design } = get();
    const el: DecorElement = {
      id: uid('t'), type: 'text', text: 'LABEL',
      x: panelWidthMm(design.hp) / 2, y: 12, sizeMm: 3.2,
      fontFamily: 'Inter', fontWeight: 700,
      letterSpacing: 0.2, align: 'center', rotation: 0,
      // Flush by default: a level face in a second colour is what panel
      // lettering usually is, and it prints without anything standing proud.
      color: '#f2f2f0', mode: 'flush', reliefMm: 0.6,
    };
    get().addDecor(el);
    return el.id;
  },

  addShapeElement: () => {
    const { design } = get();
    const W = panelWidthMm(design.hp);
    const el: DecorElement = {
      id: uid('s'), type: 'shape', shape: 'line',
      x: W / 2, y: panelHeightMm(design.format) / 2, w: W * 0.6, h: 0.8,
      radius: 0.4, rotation: 0,
      color: '#f2f2f0', mode: 'raised', reliefMm: 0.6,
    };
    get().addDecor(el);
    return el.id;
  },

  updateDecor: (id, patch) =>
    set((s) => ({
      design: {
        ...s.design,
        decor: s.design.decor.map((d) => (d.id === id ? ({ ...d, ...patch } as DecorElement) : d)),
      },
    })),

  updateDecorMany: (ids, patch) =>
    set((s) => {
      const which = new Set(ids);
      return {
        design: {
          ...s.design,
          decor: s.design.decor.map((d) => (which.has(d.id) ? ({ ...d, ...patch } as DecorElement) : d)),
        },
      };
    }),

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
        return { ...base, x: base.x + offsetMm, y: base.y + offsetMm } as DecorElement;
      });
    if (copies.length === 0) return [];
    set((s) => ({
      design: { ...s.design, decor: [...s.design.decor, ...copies] },
      selectedIds: copies.map((c) => c.id),
    }));
    return copies.map((c) => c.id);
  },

  // Traced artwork used to be the exception here, carrying absolute outlines
  // that had to be translated point by point from where the drag began. It has
  // an origin of its own now, so everything moves the same way.
  placeDecor: (id, x, y) =>
    set((s) => ({
      design: {
        ...s.design,
        decor: s.design.decor.map((d) => (d.id === id ? { ...d, x, y } as DecorElement : d)),
      },
    })),

  // --- library ---

  loadLibraryFromStorage: async () => {
    // Anything left by the localStorage era moves across once, then stays put.
    await migrateFromLocalStorage();

    // Uploaded fonts first: the moment a design arrives, its lettering is
    // asked for, and a family not registered by then is looked for on Google
    // Fonts instead, where it does not exist.
    const customFonts: string[] = [];
    for (const f of await loadFontFiles()) {
      try {
        registerFont(f.family, f.data);
        installedByHash.set(f.hash, f.family);
        customFonts.push(f.family);
      } catch {
        // A file that no longer parses is left out of the list rather than
        // stopping the app from loading.
      }
    }
    set({ customFonts: customFonts.sort((a, b) => a.localeCompare(b)) });

    const [library, rack, session] = await Promise.all([loadDesigns(), dbLoadRack(), loadSession()]);
    set({ library, rack: rack ?? defaultRack() });

    if (session) {
      set({
        design: session.design,
        savedDesign: session.design,
        past: [],
        future: [],
        designName: session.designName,
        activeDesignId: session.activeDesignId,
        dirty: session.dirty,
        crop: session.crop,
        detect: session.detect,
        mmPerPx: session.mmPerPx,
        sourceLabel: session.sourceLabel,
        sourceHp: session.sourceHp ?? null,
        sourceBlob: session.sourceBlob,
        view: (['2d', '3d', 'rack'] as const).includes(session.view as ViewMode)
          ? (session.view as ViewMode) : '2d',
        tab: (['panel', 'features', 'decor', 'export', 'library'] as const).includes(session.tab as InspectorTab)
          ? (session.tab as InspectorTab) : 'panel',
        gridMm: session.gridMm,
        showSource: session.showSource,
        sourceOpacity: session.sourceOpacity,
        restoredAt: session.savedAt,
      });

      // Decoding the picture is the slow part, so it happens after the panel
      // is already on screen rather than holding it up.
      if (session.sourceBlob) {
        void imageDataFromBlob(session.sourceBlob)
          .then((image) => set({ sourceImage: image }))
          .catch(() => set({ sourceBlob: null }));
      }
    }

    // Only now may the session be written back. Saving before this point would
    // overwrite the stored work with the empty panel the app starts on.
    set({ hydrated: true });
  },

  /** Put the restore notice away; the work itself stays. */
  discardRestored: () => set({ restoredAt: null }),

  setTheme: (choice) => {
    writeChoice(choice);
    set({ theme: choice, resolvedTheme: applyTheme(choice) });
  },

  syncTheme: () => {
    const choice = readChoice();
    set({ theme: choice, resolvedTheme: applyTheme(choice) });
  },

  saveCurrentDesign: (name) => {
    const { library, design, designName, activeDesignId, sourceUrl, sourceLabel, crop } = get();
    const id = activeDesignId ?? uid('d');
    // Keep whichever reference the panel already had if the current one cannot
    // be fetched again — re-saving a design after dragging a file in should
    // not throw away the module address it was built from.
    const previous = library.find((i) => i.id === id)?.reference;
    const reference = isRefetchable(sourceUrl) && crop
      ? { url: sourceUrl!, label: sourceLabel ?? 'Reference', crop, ...(get().sourceHp ? { hp: get().sourceHp! } : {}) }
      : previous;
    const entry: SavedDesign = {
      id,
      name: (name ?? designName).trim() || 'Untitled panel',
      updatedAt: Date.now(),
      design,
      ...(reference ? { reference } : {}),
    };
    const items = [entry, ...library.filter((i) => i.id !== entry.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt);

    set({ library: items, activeDesignId: entry.id, designName: entry.name, savedDesign: design, dirty: false });
    void putDesign(entry).catch(() =>
      set({ error: 'Could not save — the browser refused to write to local storage.' }),
    );
  },

  openDesign: (id) => {
    const found = get().library.find((i) => i.id === id);
    if (!found) return;
    set({
      design: found.design,
      savedDesign: found.design,
      past: [],
      future: [],
      activeDesignId: id,
      designName: found.name,
      dirty: false,
      selectedIds: [],
      // Cleared first either way, so another panel's picture is never left
      // sitting underneath this one while its own is on the way.
      sourceImage: null,
      sourceUrl: found.reference?.url ?? null,
      sourceLabel: found.reference?.label ?? null,
      sourceHp: found.reference?.hp ?? null,
      sourceBlob: null,
      crop: found.reference?.crop ?? null,
      mmPerPx: null,
      view: '2d',
    });
    if (found.reference) void get().restoreReference(id, found.reference);
  },

  /**
   * Fetch a saved design's reference photo back in.
   *
   * Deliberately not setSource: that one re-reads the width from the picture
   * and runs detection again, which would replace the cutouts the design was
   * saved with. This puts the photo back underneath and nothing else.
   *
   * The design id is carried through because the fetch can outlast the user's
   * interest — open one panel, change your mind, open another — and the
   * picture that arrives late belongs to the panel that asked for it.
   */
  restoreReference: async (designId, ref) => {
    try {
      const { blob, image } = await fetchImage(ref.url);
      if (get().activeDesignId !== designId) return;
      set({ sourceImage: image, sourceBlob: blob });
    } catch {
      if (get().activeDesignId !== designId) return;
      // Not an error worth interrupting for: the panel is intact and the
      // photo was only ever a tracing aid.
      set({ sourceImage: null, sourceUrl: null, sourceLabel: null, crop: null });
    }
  },

  /**
   * Step back, and forward again.
   *
   * The panel is the unit: its cutouts, its decor, its settings and its name.
   * Not the library or the rack, which are filing rather than drawing, and
   * where an undo would be a surprise rather than a convenience.
   *
   * Nothing is recorded while one of these is running, or the step back would
   * itself become something to step back from.
   */
  undo: () => {
    const { past, design, designName, savedDesign } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    restoring = true;
    set({
      past: past.slice(0, -1),
      future: [...get().future, { design, designName }],
      design: prev.design,
      designName: prev.designName,
      selectedIds: [],
      dirty: prev.design !== savedDesign,
    });
    restoring = false;
  },

  redo: () => {
    const { future, design, designName, savedDesign } = get();
    const next = future[future.length - 1];
    if (!next) return;
    restoring = true;
    set({
      future: future.slice(0, -1),
      past: [...get().past, { design, designName }],
      design: next.design,
      designName: next.designName,
      selectedIds: [],
      dirty: next.design !== savedDesign,
    });
    restoring = false;
  },

  newDesign: () => {
    void clearSession();
    set({
      design: DEFAULT_DESIGN,
      savedDesign: DEFAULT_DESIGN,
      activeDesignId: null,
      past: [],
      future: [],
      designName: 'Untitled panel',
      dirty: false,
      selectedIds: [],
      sourceImage: null,
      sourceUrl: null,
      sourceLabel: null,
      sourceHp: null,
      sourceBlob: null,
      crop: null,
      mmPerPx: null,
      view: '2d',
      restoredAt: null,
    });
  },

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
    void loadFontFiles().then((fonts) =>
      downloadJson(buildPanelBackup(found, fonts), backupFilename('panel', found.name)));
  },

  exportRack: () => {
    const { rack, library } = get();
    void loadFontFiles().then((fonts) =>
      downloadJson(buildRackBackup(rack, library, fonts), backupFilename('rack', rack.name)));
  },

  exportEverything: () => {
    const { rack, library } = get();
    void loadFontFiles().then((fonts) =>
      downloadJson(buildLibraryBackup(library, rack, fonts), backupFilename('library')));
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

    // Fonts before panels: the moment the panels land, their lettering is
    // asked for, and a family not registered by then is looked for on Google
    // Fonts instead. A font identical to one installed is that font, under
    // whatever name it has here; a different font whose name is taken gets a
    // name of its own. Either way its labels are renamed to follow it.
    const rename = new Map<string, string>();
    let fontsAdded = 0;
    for (const f of payload.fonts ?? []) {
      try {
        const installed = await installFont(f.family, base64ToBytes(f.data));
        if (installed.family !== f.family) rename.set(f.family, installed.family);
        if (installed.added) fontsAdded++;
      } catch {
        // A damaged font leaves its lettering missing, not the import failed.
      }
    }
    const incoming = renameFontFamilies(payload, rename);
    const merged = mergeBackup(get().library, incoming, { replaceRack });
    const report = { ...merged.report, fontsAdded };

    set((st) => ({
      library: merged.library,
      rack: merged.rack ?? st.rack,
      lastImport: { ...report, at: Date.now() },
      error: null,
    }));

    await putDesigns(incoming.panels);
    if (merged.rack) await dbSaveRack(merged.rack);
    return report;
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
    if (width <= 0) return false;

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
      return true;
    }
    set({ error: `No room for a ${width} HP panel. Add a row, or make one wider.` });
    return false;
  },

  emptyRack: () => {
    const rack = touchRack({
      ...get().rack,
      rows: get().rack.rows.map((r) => ({ ...r, placements: [] })),
    });
    void dbSaveRack(rack);
    set({ rack });
  },

  /**
   * Start over completely.
   *
   * Everything lives in this browser and nothing is kept anywhere else, so
   * this cannot be undone — which is why the button asks first and points at
   * Export on the way past.
   */
  clearEverything: async () => {
    const ids = get().library.map((d) => d.id);
    const rack = touchRack({ name: 'My rack', rows: [emptyRow(), emptyRow()] });
    set({
      library: [],
      rack,
      activeDesignId: null,
      designName: 'Untitled panel',
      design: DEFAULT_DESIGN,
      savedDesign: DEFAULT_DESIGN,
      dirty: false,
      past: [],
      future: [],
      selectedIds: [],
      sourceImage: null,
      sourceUrl: null,
      sourceLabel: null,
      sourceHp: null,
      sourceBlob: null,
      crop: null,
      mmPerPx: null,
      lastImport: null,
      restoredAt: null,
      view: '2d',
    });
    await Promise.all(ids.map((id) => dbDeleteDesign(id)));
    await dbSaveRack(rack);
    await clearSession();
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

  addCustomFont: async (file) => {
    const data = await file.arrayBuffer();
    const wanted = file.name.replace(/\.(ttf|otf)$/i, '').trim() || 'My font';
    try {
      return (await installFont(wanted, data)).family;
    } catch {
      set({ error: `"${file.name}" could not be read as a font. Use a TrueType (.ttf) or OpenType (.otf) file.` });
      return null;
    }
  },
}));

/** Installed uploaded fonts by the SHA-256 of their file. */
const installedByHash = new Map<string, string>();
let fontInstalls: Promise<unknown> = Promise.resolve();

/**
 * Install a font file, or find the identical one already installed.
 *
 * Matched by content, so the same file uploaded twice, or brought back by a
 * backup under another name, is one font rather than two. A different file
 * never replaces an installed one: if its name is taken it is stored as
 * "Name (2)". Runs one at a time, since two installs at once would both see
 * the same name as free. Throws if the file is not a font.
 */
function installFont(wanted: string, data: ArrayBuffer): Promise<{ family: string; added: boolean }> {
  const run = fontInstalls.then(async () => {
    const hash = await hashFont(data);
    const existing = installedByHash.get(hash);
    if (existing) return { family: existing, added: false };

    const family = uploadedFontName(wanted, useStore.getState().customFonts);
    registerFont(family, data.slice(0));
    installedByHash.set(hash, family);
    useStore.setState((s) => ({
      customFonts: [...s.customFonts, family].sort((a, b) => a.localeCompare(b)),
    }));
    try {
      await putFontFile({ family, data, hash });
    } catch {
      useStore.setState({
        error: `"${family}" works for now, but could not be stored and will be gone after a reload.`,
      });
    }
    return { family, added: true };
  });
  fontInstalls = run.catch(() => {});
  return run;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The name a newly loaded source should give the panel, if any. */
function nameFor(s: State, label: string | null | undefined): string {
  const suggestion = (label ?? '').trim();
  // Only worth using when it reads as a module name rather than a file name.
  if (!suggestion || /\.(jpe?g|png|webp|gif|avif)$/i.test(suggestion)) return s.designName;
  // Never rename somebody's saved panel out from under them.
  if (s.activeDesignId !== null) return s.designName;
  return suggestion;
}

/**
 * A cutout at this component's standard size.
 *
 * Shared by placing one by hand and by changing an existing cutout's type, so
 * that both routes produce the same geometry: a jack is a jack whether it was
 * detected, placed, or converted from something else.
 */
export function featureForKind(kind: FeatureKind): Omit<Feature, 'id'> {
  const spec = COMPONENT_SPECS[kind];
  const w = spec.holeMm || 5;
  if (spec.shape === 'circle') {
    return { kind, x: 0, y: 0, shape: 'circle', w, h: w, radius: w / 2, rotation: 0 };
  }
  const h = spec.holeHeightMm ?? w;
  // Faders and mounting slots are stadiums; a display cutout is a soft-cornered
  // rectangle rather than a rounded-off one.
  const stadium = kind === 'slider' || kind === 'mount';
  return {
    kind, x: 0, y: 0, shape: 'rect',
    w: Math.max(w, h), h: Math.min(w, h),
    radius: stadium ? Math.min(w, h) / 2 : 1,
    rotation: kind === 'slider' ? 90 : 0,
  };
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
/**
 * Keep the work in progress written down.
 *
 * Subscribing in one place rather than calling a save from every action means
 * nothing can be added later that quietly forgets to persist. Debounced,
 * because a drag changes state on every pointer move and none of the
 * intermediate positions are worth a write.
 */
const SESSION_DEBOUNCE_MS = 600;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;

useStore.subscribe((state, prev) => {
  if (!state.hydrated) return;
  const changed =
    state.design !== prev.design ||
    state.designName !== prev.designName ||
    state.activeDesignId !== prev.activeDesignId ||
    state.crop !== prev.crop ||
    state.detect !== prev.detect ||
    state.sourceBlob !== prev.sourceBlob ||
    state.sourceLabel !== prev.sourceLabel ||
    state.sourceHp !== prev.sourceHp ||
    state.view !== prev.view ||
    state.tab !== prev.tab ||
    state.gridMm !== prev.gridMm ||
    state.showSource !== prev.showSource ||
    state.sourceOpacity !== prev.sourceOpacity;
  if (!changed) return;

  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    const s = useStore.getState();
    const session: Session = {
      design: s.design,
      designName: s.designName,
      activeDesignId: s.activeDesignId,
      dirty: s.dirty,
      crop: s.crop,
      detect: s.detect,
      mmPerPx: s.mmPerPx,
      sourceLabel: s.sourceLabel,
      sourceHp: s.sourceHp,
      sourceBlob: s.sourceBlob,
      view: s.view,
      tab: s.tab,
      gridMm: s.gridMm,
      showSource: s.showSource,
      sourceOpacity: s.sourceOpacity,
      savedAt: Date.now(),
    };
    void saveSession(session);
  }, SESSION_DEBOUNCE_MS);
});

export const selectPanelSize = (s: State) => ({
  w: panelWidthMm(s.design.hp),
  h: panelHeightMm(s.design.format),
});

export { CUTOUT_PRESETS, STANDARD_KINDS, COMPONENT_SPECS, conflicts };
export type { FeatureKind, PanelFormat, SourceKind };


/**
 * Keep the fonts loaded in step with whatever is going to be built.
 *
 * This used to be an effect inside the 2D canvas, which meant the fonts a
 * design needed were only ever requested while that design was open in the
 * editor. Every other panel got built without them: open the rack and each
 * saved panel's lettering was dropped, and the rack export went out with no
 * lettering on it at all. Whose fonts are needed is a property of the state,
 * not of which component happens to be mounted, so it belongs here.
 *
 * The designs that get built are the open one and any placed in the rack —
 * not the whole library, which could be a hundred panels nobody is asking to
 * see. ensureFont is idempotent and keyed by family and weight, so repeats
 * cost nothing.
 */
export function fontNeedsForBuilds(
  s: Pick<State, 'design' | 'library' | 'rack'>,
): ReturnType<typeof fontsUsedBy> {
  const placed = new Set(s.rack.rows.flatMap((r) => r.placements.map((p) => p.designId)));
  const designs = [s.design, ...s.library.filter((d) => placed.has(d.id)).map((d) => d.design)];
  const needed = new Map<string, { family: string; weight: number }>();
  for (const design of designs) {
    for (const need of fontsUsedBy(design)) needed.set(`${need.family}@${need.weight}`, need);
  }
  return [...needed.values()];
}

/**
 * The tab that edits what is selected: Cutouts for cutouts, Text & art for
 * labels, shapes and artwork. Nothing for a mix, which neither tab can edit
 * as a whole, so the tab is left where it is.
 */
export function tabForSelection(s: Pick<State, 'design' | 'selectedIds'>): InspectorTab | null {
  if (s.selectedIds.length === 0) return null;
  const features = new Set(s.design.features.map((f) => f.id));
  const decor = new Set(s.design.decor.map((d) => d.id));
  if (s.selectedIds.every((id) => features.has(id))) return 'features';
  if (s.selectedIds.every((id) => decor.has(id))) return 'decor';
  return null;
}

// Selecting something opens the tab that edits it, wherever it was selected
// from, so a sweep across several labels lands on their batch editor rather
// than on whichever tab happened to be open.
useStore.subscribe((state, prev) => {
  if (state.selectedIds === prev.selectedIds) return;
  const tab = tabForSelection(state);
  if (tab && tab !== state.tab) useStore.setState({ tab });
});

useStore.subscribe((state, prev) => {
  if (state.design === prev.design && state.library === prev.library && state.rack === prev.rack) return;
  for (const { family, weight } of fontNeedsForBuilds(state)) state.ensureFont(family, weight);
});


/**
 * A panel counts as changed the moment its design stops being the one that
 * was saved.
 *
 * This used to be each action's own business, declared alongside the edit,
 * and most of them had simply never declared it: adding, moving and deleting
 * cutouts and decor all left the panel looking saved, so the Save button sat
 * there greyed out with real work in front of it. Deleting a cutout was where
 * it was noticed.
 *
 * Every edit replaces the design object, so the comparison is by reference.
 * Only ever set here, never cleared: saving, opening and starting fresh clear
 * it themselves, and a rename is a change the design object cannot show.
 */
useStore.subscribe((state, prev) => {
  if (state.design === prev.design || state.dirty) return;
  if (state.design === state.savedDesign) return;
  useStore.setState({ dirty: true });
});

/**
 * Keep the panel's previous states, so an edit can be taken back.
 *
 * Recorded here for the same reason dirty is: every edit replaces the design
 * object, so one rule catches all of them including the ones not written yet.
 * A load replaces it too, which is why those clear the history themselves
 * rather than being recorded as a step.
 */
useStore.subscribe((state, prev) => {
  if (restoring) return;
  if (state.design === prev.design && state.designName === prev.designName) return;
  if (state.design === state.savedDesign && state.past.length === 0) return;

  const now = Date.now();
  const burst = now - lastPushAt < COALESCE_MS && state.past.length > 0;
  lastPushAt = now;
  if (burst) {
    // Already holding the state before this gesture began; a later frame of
    // the same gesture is not a step of its own.
    if (state.future.length > 0) useStore.setState({ future: [] });
    return;
  }

  const past = [...state.past, { design: prev.design, designName: prev.designName }];
  useStore.setState({
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    // A fresh edit is a new branch, so there is nothing left to redo.
    future: [],
  });
});
