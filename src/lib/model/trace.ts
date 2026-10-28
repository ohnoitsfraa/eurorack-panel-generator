import { cropImage, fitWithin, imageDataFromSource } from '../cv/image';
import { maskFromImage, traceContours } from '../geom/contours';
import type { Ring } from '../geom/poly';
import type { Pt } from '../types';

export interface TraceOptions {
  threshold: number;
  invert: boolean;
  /** Douglas-Peucker tolerance in working pixels. */
  simplifyPx: number;
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
 * Trace a bitmap into outlines, in the pixels of the whole picture.
 *
 * The picture's own pixels rather than panel millimetres, and of the whole
 * picture rather than of the crop, so two traces of the same file with
 * different crops land on the same grid: that is what lets a re-crop keep the
 * part still in the box exactly where and as large as it was. Placing the
 * outlines on the panel is the caller's business.
 *
 * The result is ordinary ring geometry, so traced art behaves exactly like
 * text or a shape from then on: it can be raised, engraved, recoloured, and
 * it exports.
 */
export async function traceArtwork(file: Blob, opts: TraceOptions): Promise<Ring[]> {
  const url = URL.createObjectURL(file);
  try {
    const full = await imageDataFromSource(url);
    // Cropped before the resolution cap, so the part being traced gets the
    // whole budget rather than a share of a picture mostly thrown away.
    const box = opts.crop ? cropBox(full, opts.crop) : { x: 0, y: 0, w: full.width, h: full.height };
    const picked = opts.crop ? cropImage(full, box.x, box.y, box.w, box.h) : full;
    const img = fitWithin(picked, TRACE_MAX_DIM);

    const mask = maskFromImage(img, opts.threshold, opts.invert);
    const rings = traceContours(mask, img.width, img.height, opts.simplifyPx);
    const k = box.w / img.width;
    return rings.map((r) => r.map((p: Pt) => ({ x: box.x + p.x * k, y: box.y + p.y * k })));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The fractional box as whole pixels, kept inside the image and non-empty. */
function cropBox(
  img: ImageData,
  c: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(img.width - 1, Math.round(c.x * img.width)));
  const y = Math.max(0, Math.min(img.height - 1, Math.round(c.y * img.height)));
  const w = Math.max(1, Math.min(img.width - x, Math.round(c.w * img.width)));
  const h = Math.max(1, Math.min(img.height - y, Math.round(c.h * img.height)));
  return { x, y, w, h };
}
