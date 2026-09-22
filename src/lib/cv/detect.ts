import { panelWidthMm, panelHeightMm } from '../eurorack';
import type { DetectSettings, DetectionResult, Feature, PanelFormat } from '../types';
import { blur, cropImage, fitWithin, percentiles, toGray, type Gray } from './image';
import { binarizeDark, thresholdLadder } from './threshold';
import { findBlobs, type Blob } from './components';
import { classifyBlob, type Candidate } from './classify';
import { COMPONENT_SPECS, type FeatureKind } from '../eurorack';

/** Working resolution. Big enough to resolve a 3 mm LED, small enough to be instant. */
const WORK_MAX_DIM = 1400;

export interface DetectInput {
  image: ImageData;
  hp: number;
  format: PanelFormat;
  /** Crop in source-image pixels. Defaults to the auto-detected panel bounds. */
  crop?: { x: number; y: number; w: number; h: number };
  settings: DetectSettings;
}

/**
 * Find the panel inside a photo.
 *
 * ModularGrid renders are already tight crops, so the common case must be a
 * no-op. We look for a margin of near-uniform colour around the edges and trim
 * it; if the border is not uniform (a real photo on a busy desk) we bail out
 * and return the full frame for the user to crop by hand.
 */
export function autoCrop(img: ImageData): { x: number; y: number; w: number; h: number } {
  const g = toGray(img);
  const { width: w, height: h } = g;

  // Sample the four borders; if they disagree there is no clean background.
  const corners = [g.data[0], g.data[w - 1], g.data[(h - 1) * w], g.data[h * w - 1]];
  const bg = corners.reduce((a, b) => a + b, 0) / 4;
  const spread = Math.max(...corners) - Math.min(...corners);
  if (spread > 40) return { x: 0, y: 0, w: img.width, h: img.height };

  const tol = 18;
  const rowIsBg = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (Math.abs(g.data[y * w + x] - bg) <= tol) n++;
    return n / w > 0.97;
  };
  const colIsBg = (x: number) => {
    let n = 0;
    for (let y = 0; y < h; y++) if (Math.abs(g.data[y * w + x] - bg) <= tol) n++;
    return n / h > 0.97;
  };

  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < bottom && rowIsBg(top)) top++;
  while (bottom > top && rowIsBg(bottom)) bottom--;
  while (left < right && colIsBg(left)) left++;
  while (right > left && colIsBg(right)) right--;

  const cw = right - left + 1;
  const ch = bottom - top + 1;
  // Reject a degenerate crop rather than returning something unusable.
  if (cw < w * 0.2 || ch < h * 0.2) return { x: 0, y: 0, w: img.width, h: img.height };
  return { x: left, y: top, w: cw, h: ch };
}

export function detectFeatures(input: DetectInput): DetectionResult {
  const { image, hp, format, settings } = input;
  const crop = input.crop ?? autoCrop(image);

  const cropped = cropImage(image, crop.x, crop.y, crop.w, crop.h);
  const work = fitWithin(cropped, WORK_MAX_DIM);

  // The panel's physical size is known, so the scale falls out of the crop.
  // We derive it from width and height independently and average, which
  // absorbs a little aspect-ratio error in a hand-taken photo.
  const panelW = panelWidthMm(hp);
  const panelH = panelHeightMm(format);
  const mmPerPxX = panelW / work.width;
  const mmPerPxY = panelH / work.height;
  const mmPerPx = (mmPerPxX + mmPerPxY) / 2;

  const gray = blur(toGray(work), 1);
  const blobs = sweepThresholds(gray, settings, mmPerPx);

  const candidates: Candidate[] = [];
  for (const b of blobs) {
    // Anything welded to the frame edge is panel background or a shadow,
    // never a hole.
    if (b.touchesBorder) continue;
    const c = classifyBlob(b, mmPerPx, settings.sourceKind);
    if (!c) continue;
    // A slot is a rectangle rounded into a stadium; a display cutout is not.
    if (c.feature.kind === 'slider' && !settings.detectSlots) continue;
    if (c.feature.kind === 'display' && !settings.detectRects) continue;
    c.feature.x = round3(b.cx * mmPerPxX);
    c.feature.y = round3(b.cy * mmPerPxY);
    candidates.push(c);
  }

  const merged = mergeCandidates(candidates, settings.mergeDistanceMm);
  const surviving = merged.filter((c) => c.score >= scoreFloor(settings.sensitivity));
  const kept = unifyByCluster(surviving).map((c) => c.feature);

  const snapped = settings.snapMm > 0 ? kept.map((f) => snapFeature(f, settings.snapMm)) : kept;
  snapped.sort((a, b) => a.y - b.y || a.x - b.x);

  // Report the scale against the crop the user actually sees, not the
  // downsampled copy we analysed, so the figure in the UI is checkable.
  const workScale = work.width / cropped.width;
  return { features: snapped, mmPerPx: mmPerPx * workScale, crop };
}

function sweepThresholds(gray: Gray, settings: DetectSettings, mmPerPx: number): Blob[] {
  const [lo, hi] = percentiles(gray, 0.02, 0.98);
  // More sensitivity means more rungs on the ladder: more chances for a
  // marginal shape to show up at some exposure level.
  const steps = Math.round(5 + settings.sensitivity * 9);
  const levels = thresholdLadder(gray, lo, Math.min(hi, lo + (hi - lo) * 0.85), steps);

  const minR = settings.minSizeMm / 2 / mmPerPx;
  const maxR = settings.maxSizeMm / 2 / mmPerPx;
  const minArea = Math.max(6, Math.PI * minR * minR * 0.35);
  // Slots are long and thin, so cap on the bounding area of the longest
  // plausible fader rather than on a circle of maxSize.
  const maxArea = Math.PI * maxR * maxR * 4;

  const all: Blob[] = [];
  for (const level of levels) {
    const mask = binarizeDark(gray, level);
    all.push(...findBlobs(mask, gray.width, gray.height, minArea, maxArea, level));
  }
  return all;
}

/**
 * Collapse the same physical hole found at several threshold levels.
 *
 * Blobs are grouped by centre proximity. Support (how many levels saw it) is a
 * strong stability signal, so it feeds back into the final score: a hole that
 * survives nine exposures is real, one that appears at a single level usually
 * is not.
 */
function mergeCandidates(cands: Candidate[], mergeMm: number): Candidate[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const out: Candidate[] = [];

  for (const c of sorted) {
    const near = out.find((o) => {
      const dx = o.feature.x - c.feature.x;
      const dy = o.feature.y - c.feature.y;
      return Math.hypot(dx, dy) <= mergeMm;
    });
    if (near) {
      near.support++;
      // Keep the best-scoring geometry, but let repeated sightings of a
      // different shape correct an early mistake.
      if (c.score > near.score) {
        const { x, y } = near.feature;
        near.feature = { ...c.feature, id: near.feature.id, x, y };
        near.score = c.score;
      }
    } else {
      out.push({ ...c, feature: { ...c.feature } });
    }
  }

  for (const c of out) {
    const stability = Math.min(1, (c.support - 1) / 4);
    c.score = c.score * (0.55 + 0.45 * stability);
    c.feature.confidence = Math.round(Math.max(0, Math.min(1, c.score)) * 100) / 100;
  }
  return out;
}

/**
 * Make holes of the same size agree on what they are.
 *
 * Classified one at a time, a row of identical jacks does not come out
 * identical: measurement noise pushes some across a size boundary and they
 * arrive as buttons or LEDs, so the finished panel has jacks in three sizes.
 * But a panel with twenty holes the same size has twenty of the same
 * component — that is what "the same size" means on a front panel.
 *
 * So circular holes are grouped by measured diameter, and each group is
 * decided once, by the total confidence behind each candidate kind rather than
 * a simple count, so that a handful of strong readings outweigh many weak
 * ones. Every hole in the group then takes that component's standard size.
 */
function unifyByCluster(cands: Candidate[]): Candidate[] {
  const circles = cands.filter((c) => c.feature.shape === 'circle');
  if (circles.length < 2) return cands;

  // Group by size, allowing a tolerance that scales with the hole: a tenth of
  // a millimetre matters on a 3 mm LED and not at all on a 20 mm knob.
  const sorted = [...circles].sort((a, b) => a.measuredMm - b.measuredMm);
  const groups: Candidate[][] = [];
  let current: Candidate[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = current[current.length - 1].measuredMm;
    const tolerance = Math.max(0.35, prev * 0.16);
    if (sorted[i].measuredMm - prev <= tolerance) current.push(sorted[i]);
    else { groups.push(current); current = [sorted[i]]; }
  }
  groups.push(current);

  const decided = new Map<string, Candidate>();
  for (const group of groups) {
    if (group.length === 1) { decided.set(group[0].feature.id, group[0]); continue; }

    const weight = new Map<FeatureKind, number>();
    for (const c of group) {
      weight.set(c.feature.kind, (weight.get(c.feature.kind) ?? 0) + c.score);
    }
    let winner: FeatureKind = group[0].feature.kind;
    let best = -1;
    for (const [kind, w] of weight) if (w > best) { best = w; winner = kind; }

    const spec = COMPONENT_SPECS[winner];
    for (const c of group) {
      const agreed = c.feature.kind === winner;
      decided.set(c.feature.id, {
        ...c,
        feature: {
          ...c.feature,
          kind: winner,
          w: spec.holeMm,
          h: spec.holeMm,
          radius: spec.holeMm / 2,
          // Say so when a hole was reassigned to match its neighbours, so a
          // genuinely odd one out is still easy to find and correct.
          confidence: agreed
            ? c.feature.confidence
            : Math.min(c.feature.confidence ?? 0.5, 0.6),
        },
      });
    }
  }

  return cands.map((c) => decided.get(c.feature.id) ?? c);
}

/** Sensitivity 0 keeps only near-certain holes; 1 keeps almost everything. */
function scoreFloor(sensitivity: number): number {
  return 0.55 - 0.45 * Math.max(0, Math.min(1, sensitivity));
}

function snapFeature(f: Feature, grid: number): Feature {
  return { ...f, x: Math.round(f.x / grid) * grid, y: Math.round(f.y / grid) * grid };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
