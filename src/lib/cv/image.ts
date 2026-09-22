/** Small, dependency-free raster helpers. All operate on plain typed arrays. */

export interface Gray {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function toGray(img: ImageData): Gray {
  const { width, height, data } = img;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // Rec. 601 luma. Alpha is composited against white so that transparent
    // PNG margins (common on ModularGrid renders) read as background, not holes.
    const a = data[p + 3] / 255;
    const r = data[p] * a + 255 * (1 - a);
    const g = data[p + 1] * a + 255 * (1 - a);
    const b = data[p + 2] * a + 255 * (1 - a);
    out[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return { data: out, width, height };
}

/** Box-filter downscale to fit within `maxDim`, preserving aspect ratio. */
export function fitWithin(img: ImageData, maxDim: number): ImageData {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  return resize(img, w, h);
}

export function resize(img: ImageData, w: number, h: number): ImageData {
  const out = new ImageData(w, h);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * img.width + xx) * 4;
          r += img.data[p]; g += img.data[p + 1]; b += img.data[p + 2]; a += img.data[p + 3];
          n++;
        }
      }
      const q = (y * w + x) * 4;
      out.data[q] = r / n; out.data[q + 1] = g / n; out.data[q + 2] = b / n;
      out.data[q + 3] = a / n;
    }
  }
  return out;
}

export function cropImage(img: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.min(img.width - cx, Math.round(w));
  const ch = Math.min(img.height - cy, Math.round(h));
  const out = new ImageData(Math.max(1, cw), Math.max(1, ch));
  for (let j = 0; j < ch; j++) {
    const src = ((cy + j) * img.width + cx) * 4;
    out.data.set(img.data.subarray(src, src + cw * 4), j * cw * 4);
  }
  return out;
}

/** Separable 3-tap blur, run `passes` times. Approximates a Gaussian. */
export function blur(src: Gray, passes = 1): Gray {
  const { width: w, height: h } = src;
  let a = src.data;
  let b = new Uint8ClampedArray(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const l = x > 0 ? a[i - 1] : a[i];
        const r = x < w - 1 ? a[i + 1] : a[i];
        b[i] = (l + a[i] * 2 + r) / 4;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        const u = y > 0 ? b[i - w] : b[i];
        const d = y < h - 1 ? b[i + w] : b[i];
        a[i] = (u + b[i] * 2 + d) / 4;
      }
    }
    // Horizontal wrote a->b, vertical wrote b->a, so the result is in `a`
    // already and `b` is free scratch for the next pass.
  }
  return { data: a, width: w, height: h };
}

/** 5th and 95th percentile of the histogram, used to normalise contrast. */
export function percentiles(g: Gray, lo = 0.05, hi = 0.95): [number, number] {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  let acc = 0;
  let loV = 0;
  let hiV = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * lo) { loV = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * (1 - hi)) { hiV = v; break; }
  }
  return [loV, Math.max(loV + 1, hiV)];
}

/**
 * Decode an encoded image into pixels.
 *
 * Kept separate from fetching so the original bytes can be held on to. Storing
 * those rather than the decoded pixels is the difference between about a
 * megabyte and fifty for a phone photograph, and avoids re-encoding detail
 * that the detector needs.
 */
export async function imageDataFromBlob(blob: Blob): Promise<ImageData> {
  const url = URL.createObjectURL(blob);
  try {
    return await imageDataFromSource(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fetch an image and return both its bytes and its pixels. */
export async function fetchImage(src: string): Promise<{ blob: Blob; image: ImageData }> {
  const res = await fetch(src);
  if (!res.ok) {
    // The proxy explains itself in JSON; pass that on rather than a bare code.
    let reason = `Could not load that image (${res.status})`;
    try {
      const body = await res.clone().json();
      if (typeof body?.error === 'string') reason = body.error;
    } catch { /* not JSON, keep the generic message */ }
    throw new Error(reason);
  }
  const blob = await res.blob();
  return { blob, image: await imageDataFromBlob(blob) };
}

export async function imageDataFromSource(src: string): Promise<ImageData> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image'));
    img.src = src;
  });
}
