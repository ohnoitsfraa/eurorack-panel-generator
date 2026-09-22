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
export interface Feature {
  id: string;
  kind: FeatureKind;
  /** Centre position in mm, panel space. */
  x: number;
  y: number;
  shape: 'circle' | 'slot' | 'rect';
  /** Circle: diameter. Slot: slot width. Rect: width. All mm. */
  d: number;
  /** Slot: overall length. Rect: height. Unused for circles. */
  len?: number;
  /** Corner radius for rect features, mm. */
  radius?: number;
  /** Rotation about the centre, degrees clockwise. */
  rotation?: number;
  /** Detector confidence 0..1. Undefined for hand-placed features. */
  confidence?: number;
  locked?: boolean;
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
