import type { FeatureKind, PanelFormat, SourceKind } from './eurorack';

export type { FeatureKind, PanelFormat, SourceKind };

/** A 2D point in panel space: millimetres, origin at the panel's top-left, +y down. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * A cutout in the panel.
 *
 * Every feature carries its own geometry rather than deriving it from `kind`, so
 * the user can nudge a single jack's diameter without inventing a new kind.
 */
/**
 * A cutout.
 *
 * Only two shapes, because only two are needed: a circle, and a rectangle with
 * a corner radius. A radius of zero gives sharp corners, and a radius of half
 * the shorter side gives a stadium — which is what a fader slot or a mounting
 * slot actually is. Carrying a separate slot shape only meant three ways to
 * describe the same geometry.
 *
 * Width and height are always both present. For a circle they are equal and
 * are its diameter, which keeps resizing and bounds calculations from needing
 * a special case at every turn.
 */
export interface Feature {
  id: string;
  kind: FeatureKind;
  /** Centre position in mm, panel space. */
  x: number;
  y: number;
  shape: 'circle' | 'rect';
  /** Width in mm. For a circle, its diameter. */
  w: number;
  /** Height in mm. For a circle, equal to the width. */
  h: number;
  /** Corner radius in mm. Clamped to half the shorter side when built. */
  radius: number;
  /** Rotation about the centre, degrees clockwise. */
  rotation: number;
  /** Detector confidence 0..1. Undefined for hand-placed features. */
  confidence?: number;
  locked?: boolean;
}

/**
 * A short human description of a cutout.
 *
 * Named components use their name; anything placed by hand is described by
 * what it actually is, since "Custom" tells you nothing when you are scanning
 * a list of twenty cutouts.
 */
export function describeFeature(f: Feature, componentLabel?: string): string {
  if (componentLabel && f.kind !== 'custom') return componentLabel;
  const mm = (v: number) => (Math.round(v * 100) / 100).toString();
  if (f.shape === 'circle') return `Circle ${mm(f.w)} mm`;
  if (isStadium(f)) return `Slot ${mm(f.w)} × ${mm(f.h)} mm`;
  return `${f.radius > 0 ? 'Rounded rect' : 'Rectangle'} ${mm(f.w)} × ${mm(f.h)} mm`;
}

/** True when the radius is large enough that the rectangle reads as a slot. */
export function isStadium(f: Feature): boolean {
  return f.shape === 'rect' && f.radius >= Math.min(f.w, f.h) / 2 - 1e-6;
}

/**
 * Bring a feature from an older saved file up to date.
 *
 * Files written before the shapes were collapsed carry `d`, `len` and a `slot`
 * shape. They are still perfectly good designs, so they are converted rather
 * than rejected: a slot becomes a rectangle whose corner radius rounds it into
 * the same stadium it always was.
 */
export function migrateFeature(raw: unknown): Feature | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== 'string' || typeof f.x !== 'number' || typeof f.y !== 'number') return null;

  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const shape = f.shape;
  const rotation = num(f.rotation, 0);
  const base = {
    id: f.id,
    kind: (typeof f.kind === 'string' ? f.kind : 'custom') as FeatureKind,
    x: f.x,
    y: f.y,
    rotation,
    confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
    locked: f.locked === true ? true : undefined,
  };

  if (shape === 'circle') {
    const d = num(f.w, num(f.d, 6));
    return { ...base, shape: 'circle', w: d, h: d, radius: d / 2 };
  }
  if (shape === 'slot') {
    // Old slots stored thickness in `d` and overall length in `len`.
    const thickness = num(f.d, 4);
    const length = Math.max(num(f.len, thickness), thickness);
    return { ...base, shape: 'rect', w: length, h: thickness, radius: thickness / 2 };
  }
  // Already-new rectangles carry w/h; old ones carried d/len.
  const w = num(f.w, num(f.d, 10));
  const h = num(f.h, num(f.len, w));
  return { ...base, shape: 'rect', w, h, radius: Math.min(num(f.radius, 0), Math.min(w, h) / 2) };
}

/** Run every feature in a design through the migration. */
export function migrateDesign(design: PanelDesign): PanelDesign {
  return {
    ...design,
    features: (design.features ?? [])
      .map((f) => migrateFeature(f))
      .filter((f): f is Feature => f !== null),
  };
}

export type ReliefMode = 'raised' | 'engraved';

export interface TextElement {
  id: string;
  type: 'text';
  text: string;
  x: number;
  y: number;
  /** Cap height in mm. */
  sizeMm: number;
  fontFamily: string;
  fontWeight: number;
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
  rotation: number;
  color: string;
  mode: ReliefMode;
  /** Height above (raised) or depth below (engraved) the panel face, mm. */
  reliefMm: number;
}

export interface ArtElement {
  id: string;
  type: 'art';
  /** Even-odd polygon rings in mm, panel space, already positioned. */
  rings: Pt[][];
  color: string;
  mode: ReliefMode;
  reliefMm: number;
  /** Kept so the UI can re-trace at a different threshold without a re-upload. */
  source?: { imageId: string; threshold: number };
}

export interface ShapeElement {
  id: string;
  type: 'shape';
  shape: 'rect' | 'circle' | 'line';
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  rotation: number;
  color: string;
  mode: ReliefMode;
  reliefMm: number;
}

export type DecorElement = TextElement | ArtElement | ShapeElement;

export interface PanelDesign {
  hp: number;
  format: PanelFormat;
  thicknessMm: number;
  /** Rounded corners on the panel outline, mm. */
  cornerRadiusMm: number;
  backgroundColor: string;
  /** Data URL of a background image, used for the 2D preview only. */
  backgroundImage?: string;
  backgroundImageOpacity: number;
  backgroundImageFit: 'cover' | 'contain' | 'stretch';
  includeMountSlots: boolean;
  /** Added to every cutout when the model is built, to suit your printer. */
  holeClearanceMm: number;
  features: Feature[];
  decor: DecorElement[];
}

/** A triangle soup in mm, plus the colour it should print in. */
export interface Mesh {
  name: string;
  /** Flat xyz triples. */
  positions: Float32Array;
  /** Flat xyz triples, one normal per vertex. */
  normals: Float32Array;
  color: string;
}

export interface DetectionResult {
  features: Feature[];
  /** Scale used, for the UI to report and the user to override. */
  mmPerPx: number;
  /** Crop applied to the source image, in source pixels. */
  crop: { x: number; y: number; w: number; h: number };
  /** Debug mask, same size as the analysed image, for the overlay view. */
  debugMask?: ImageData;
  /** Detections discarded as printing rather than hardware. */
  droppedAsMarkings?: number;
}

export interface DetectSettings {
  /** Photograph of a built module, or flat panel artwork. Changes size ranges. */
  sourceKind: SourceKind;
  /** 0..1. Higher finds more, at the cost of false positives. */
  sensitivity: number;
  /** Merge detections whose centres are within this many mm. */
  mergeDistanceMm: number;
  minSizeMm: number;
  maxSizeMm: number;
  detectSlots: boolean;
  detectRects: boolean;
  /** Snap detected centres onto a grid of this pitch, mm. 0 disables. */
  snapMm: number;
}

export const DEFAULT_DETECT_SETTINGS: DetectSettings = {
  sourceKind: 'photo',
  sensitivity: 0.5,
  mergeDistanceMm: 2.0,
  minSizeMm: 2.0,
  maxSizeMm: 40.0,
  detectSlots: true,
  detectRects: true,
  snapMm: 0,
};

export function uid(prefix = 'f'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
