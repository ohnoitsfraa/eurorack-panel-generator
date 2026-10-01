import { cropImage, fitWithin, imageDataFromSource } from '../cv/image';
import { maskFromImage, traceContours } from '../geom/contours';
import { bbox, type Ring } from '../geom/poly';
import type { Pt } from '../types';

export interface TraceOptions {
  threshold: number;
  invert: boolean;
  /** Douglas-Peucker tolerance in working pixels. */
  simplifyPx: number;
  /** Width the traced art should occupy on the panel, mm. */
  targetWidthMm: number;
  panelWidthMm: number;
  panelHeightMm: number;
  /**
   * The part of the picture to trace, as fractions of its width and height.
   *
   * Fractions rather than pixels because the box is drawn on a preview whose
   * size has nothing to do with the file's. Omitted means all of it.
   */
  crop?: { x: number; y: number; w: number; h: number };
}

/** Cap on the working resolution: tracing cost grows with pixel count. */
const TRACE_MAX_DIM = 900;

/**
 * Trace a bitmap into panel-space outlines, scaled and centred.
 *
 * The result is ordinary ring geometry, so traced art behaves exactly like
 * text or a shape from then on: it can be raised, engraved, recoloured, and
 * it exports.
 */
export async function traceArtwork(file: File, opts: TraceOptions): Promise<Ring[]> {
  const url = URL.createObjectURL(file);
  try {
    const full = await imageDataFromSource(url);
    // Cropped before the resolution cap, so the part being traced gets the
    // whole budget rather than a share of a picture mostly thrown away.
    const picked = opts.crop ? cropToFraction(full, opts.crop) : full;
    const img = fitWithin(picked, TRACE_MAX_DIM);

    const mask = maskFromImage(img, opts.threshold, opts.invert);
    const rings = traceContours(mask, img.width, img.height, opts.simplifyPx);
    if (!rings.length) return [];

    // Scale to the requested width and centre on the panel.
    const b = bbox(rings);
    const srcW = Math.max(1e-6, b.x1 - b.x0);
    const srcH = Math.max(1e-6, b.y1 - b.y0);
    const scale = opts.targetWidthMm / srcW;
    const outW = srcW * scale;
    const outH = srcH * scale;
    const offX = (opts.panelWidthMm - outW) / 2;
    const offY = (opts.panelHeightMm - outH) / 2;

    return rings.map((r) =>
      r.map((p: Pt) => ({
        x: offX + (p.x - b.x0) * scale,
        y: offY + (p.y - b.y0) * scale,
      })),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The fractional box as whole pixels, kept inside the image and non-empty. */
function cropToFraction(
  img: ImageData,
  c: { x: number; y: number; w: number; h: number },
): ImageData {
  const x = Math.max(0, Math.min(img.width - 1, Math.round(c.x * img.width)));
  const y = Math.max(0, Math.min(img.height - 1, Math.round(c.y * img.height)));
  const w = Math.max(1, Math.min(img.width - x, Math.round(c.w * img.width)));
  const h = Math.max(1, Math.min(img.height - y, Math.round(c.h * img.height)));
  return cropImage(img, x, y, w, h);
}
