import { COMPONENT_SPECS, rangeFor, type FeatureKind, type SourceKind } from '../eurorack';
import type { Blob } from './components';
import type { Feature } from '../types';
import { uid } from '../types';

/**
 * Turn a blob into a panel feature.
 *
 * Because panel dimensions are standardised, we know millimetres per pixel
 * before we start, and can reason in real-world units. "A 6.2 mm circle" is a
 * 3.5 mm jack; "a 3 mm circle" is an LED; "a 3 x 60 mm slot" is a fader. That
 * is a far stronger signal than any pixel-space heuristic.
 */

export interface Candidate {
  feature: Feature;
  /** Blobs that produced this candidate across the threshold ladder. */
  support: number;
  score: number;
}

/** Shape decision thresholds, tuned against renders and photos alike. */
const CIRCLE_MAX_ELONGATION = 1.35;
const SLOT_MIN_ELONGATION = 2.2;
/** area / (major*minor) for a perfect circle inscribed in its bbox. */
const CIRCLE_FILL = Math.PI / 4;
/**
 * Fill range for a ring rather than a disc.
 *
 * Panel artwork draws a knob as a dark outline around a light face, so the
 * dark pixels form an annulus. It is round and its bounding box is square, but
 * only a fraction of that box is filled — which is exactly how to tell it from
 * a solid dot, and the only way these knobs get found at all.
 */
const RING_FILL = { min: 0.12, max: 0.62 };

export function classifyBlob(b: Blob, mmPerPx: number, source: SourceKind = 'photo'): Candidate | null {
  const majorMm = b.major * mmPerPx;
  const minorMm = b.minor * mmPerPx;
  const eqMm = b.eqDiameter * mmPerPx;

  const round = b.elongation <= CIRCLE_MAX_ELONGATION;
  const isCircular = round && Math.abs(b.rectFill - CIRCLE_FILL) < 0.14;
  const isRing = round && !isCircular && b.rectFill >= RING_FILL.min && b.rectFill <= RING_FILL.max;
  const isSlot = b.elongation >= SLOT_MIN_ELONGATION && b.rectFill > 0.6;
  const isRect = !isCircular && !isRing && b.rectFill > 0.82;

  if (isRing) {
    // The outline traces the part's rim, so its outer extent is the diameter.
    const ringMm = (majorMm + minorMm) / 2;
    const kind = circleKind(ringMm, source);
    if (!kind) return null;
    const sizeScore = rangeScore(ringMm, rangeFor(COMPONENT_SPECS[kind], source));
    // Rings are a weaker signal than solid discs, so they start lower and have
    // to earn their place through the stability check.
    const score = 0.65 * sizeScore;
    return {
      support: 1,
      score,
      feature: {
        id: uid(),
        kind,
        x: 0, y: 0,
        shape: 'circle',
        d: COMPONENT_SPECS[kind].holeMm,
        confidence: clamp01(score),
      },
    };
  }

  if (isCircular) {
    const kind = circleKind(eqMm, source);
    if (!kind) return null;
    // Confidence blends how cleanly circular it is with how squarely the
    // measured size lands inside the component's expected range.
    const shapeScore = 1 - Math.abs(b.rectFill - CIRCLE_FILL) / 0.14;
    const sizeScore = rangeScore(eqMm, rangeFor(COMPONENT_SPECS[kind], source));
    const score = 0.5 * shapeScore + 0.5 * sizeScore;
    return {
      support: 1,
      score,
      feature: {
        id: uid(),
        kind,
        x: 0, y: 0, // filled in by the caller, which owns the crop transform
        shape: 'circle',
        d: COMPONENT_SPECS[kind].holeMm,
        confidence: clamp01(score),
      },
    };
  }

  if (isSlot) {
    // A detected fader silhouette is the slider's travel slot. Panel cutouts
    // for faders are usually a touch wider than the visible gap, but we keep
    // the measurement and let the user adjust rather than guessing.
    return {
      support: 1,
      score: 0.55 * b.rectFill + 0.45 * Math.min(1, b.elongation / 8),
      feature: {
        id: uid(),
        kind: 'slider',
        x: 0, y: 0,
        shape: 'slot',
        d: round2(minorMm),
        len: round2(majorMm),
        rotation: round2((b.theta * 180) / Math.PI),
        confidence: clamp01(0.4 + 0.4 * b.rectFill),
      },
    };
  }

  if (isRect) {
    return {
      support: 1,
      score: b.rectFill,
      feature: {
        id: uid(),
        kind: 'display',
        x: 0, y: 0,
        shape: 'rect',
        d: round2(majorMm),
        len: round2(minorMm),
        radius: 0.5,
        rotation: round2((b.theta * 180) / Math.PI),
        confidence: clamp01(b.rectFill * 0.8),
      },
    };
  }

  return null;
}

/**
 * Pick the component whose expected visual size best matches a measurement.
 *
 * The ranges in COMPONENT_SPECS overlap on purpose (a big tact button and a
 * small knob really are the same size on a panel), so we score every candidate
 * and take the best rather than returning on the first range that contains the
 * value. Ties break toward the more common part via `prior`.
 */
const CIRCLE_PRIORS: Partial<Record<FeatureKind, number>> = {
  jack: 1.0,
  pot: 0.95,
  led: 0.9,
  button: 0.7,
  led5: 0.65,
  toggle: 0.6,
  buttonLarge: 0.55,
  encoder: 0.35,
  trimmer: 0.3,
};

function circleKind(diameterMm: number, source: SourceKind): FeatureKind | null {
  let best: FeatureKind | null = null;
  let bestScore = 0;
  for (const [kind, prior] of Object.entries(CIRCLE_PRIORS) as Array<[FeatureKind, number]>) {
    const s = rangeScore(diameterMm, rangeFor(COMPONENT_SPECS[kind], source)) * prior;
    if (s > bestScore) { bestScore = s; best = kind; }
  }
  return bestScore > 0.05 ? best : null;
}

/**
 * 1.0 in the middle of the range, tapering to 0 at a 25% margin outside it.
 * Soft edges matter: a jack nut photographed at a slight angle measures a
 * little small, and should not fall off a cliff into "unclassified".
 */
function rangeScore(v: number, [lo, hi]: [number, number]): number {
  const margin = (hi - lo) * 0.25;
  if (v < lo - margin || v > hi + margin) return 0;
  if (v >= lo && v <= hi) {
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2 || 1;
    return 1 - 0.25 * Math.abs(v - mid) / half;
  }
  const dist = v < lo ? lo - v : v - hi;
  return 0.75 * (1 - dist / margin);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
