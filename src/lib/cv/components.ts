/**
 * Connected-component labelling with shape statistics.
 *
 * For each blob we want enough to tell a jack from a fader from a screen
 * cutout. Raw pixel area and a bounding box are not enough: a diagonal fader
 * has a huge axis-aligned bbox that says nothing useful. So we fit an
 * orientation from the second-order image moments, then measure the blob's
 * extent in that rotated frame.
 */

export interface Blob {
  /** Centroid, image pixels. */
  cx: number;
  cy: number;
  /** Pixel count. */
  area: number;
  /** Axis-aligned bounds. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Principal-axis angle in radians, -pi/2..pi/2. */
  theta: number;
  /** Extent along the major and minor principal axes, pixels. */
  major: number;
  minor: number;
  /** area / (major * minor). ~1 for a rectangle, ~pi/4 for an ellipse. */
  rectFill: number;
  /** Diameter of a circle with the same area. */
  eqDiameter: number;
  /** major / minor, always >= 1. */
  elongation: number;
  /** True if the blob touches the image border. */
  touchesBorder: boolean;
  /** Threshold level this blob was found at. */
  level: number;
}

const NEIGHBOURS_X = [1, -1, 0, 0];
const NEIGHBOURS_Y = [0, 0, 1, -1];

/**
 * Flood-fill every 4-connected run of set pixels in `mask` and return the ones
 * whose area falls inside [minArea, maxArea].
 *
 * `mask` is consumed: visited pixels are cleared as we go.
 *
 * With `labelsOut`, each pixel of a blob that is kept is set to that blob's
 * index plus one, so a caller can ask which blob a pixel belongs to; pixels of
 * blobs that were not kept are left alone.
 */
export function findBlobs(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
  maxArea: number,
  level: number,
  labelsOut?: Int32Array,
): Blob[] {
  const blobs: Blob[] = [];
  // One scratch buffer, reused for every component, sized for the worst case.
  const stack = new Int32Array(width * height);
  const pixels = new Int32Array(Math.min(width * height, Math.ceil(maxArea) * 4 + 1024));

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;

    let sp = 0;
    stack[sp++] = start;
    mask[start] = 2; // enqueued

    let n = 0;
    let overflow = false;
    let sx = 0, sy = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    let touches = false;

    while (sp > 0) {
      const i = stack[--sp];
      const x = i % width;
      const y = (i / width) | 0;

      if (n < pixels.length) pixels[n] = i; else overflow = true;
      n++;
      sx += x; sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches = true;

      for (let k = 0; k < 4; k++) {
        const nx = x + NEIGHBOURS_X[k];
        const ny = y + NEIGHBOURS_Y[k];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === 1) { mask[ni] = 2; stack[sp++] = ni; }
      }
    }

    if (n < minArea || n > maxArea || overflow) continue;

    const cx = sx / n;
    const cy = sy / n;

    // Second-order central moments -> principal axis.
    let mu20 = 0, mu02 = 0, mu11 = 0;
    for (let k = 0; k < n; k++) {
      const i = pixels[k];
      const dx = (i % width) - cx;
      const dy = ((i / width) | 0) - cy;
      mu20 += dx * dx; mu02 += dy * dy; mu11 += dx * dy;
    }
    mu20 /= n; mu02 /= n; mu11 /= n;
    const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);

    // Extent in the rotated frame. This is what separates a real slot from a
    // fat blob: we measure the actual silhouette, not a moment approximation.
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let k = 0; k < n; k++) {
      const i = pixels[k];
      const dx = (i % width) - cx;
      const dy = ((i / width) | 0) - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    // +1 because a single-pixel-wide run still has one pixel of extent.
    const extentU = uMax - uMin + 1;
    const extentV = vMax - vMin + 1;

    // The moment axis is the axis of maximum *variance*, which is not always
    // the axis of maximum *extent*. Callers use `theta` to rotate slots, so
    // normalise it to always point along the longer side.
    const uIsMajor = extentU >= extentV;
    const major = uIsMajor ? extentU : extentV;
    const minor = uIsMajor ? extentV : extentU;
    const majorTheta = uIsMajor ? theta : theta + Math.PI / 2;
    // Fold into -pi/2..pi/2; a slot has no head or tail so the directions are
    // equivalent and this keeps rotation values stable for the UI.
    const norm = Math.atan2(Math.sin(majorTheta), Math.cos(majorTheta));
    const thetaMajor = norm > Math.PI / 2 ? norm - Math.PI : norm <= -Math.PI / 2 ? norm + Math.PI : norm;

    blobs.push({
      cx, cy, area: n, x0, y0, x1, y1,
      theta: thetaMajor,
      major,
      minor,
      rectFill: n / Math.max(1, major * minor),
      eqDiameter: 2 * Math.sqrt(n / Math.PI),
      elongation: major / Math.max(1e-6, minor),
      touchesBorder: touches,
      level,
    });
    if (labelsOut) {
      const label = blobs.length;
      for (let k = 0; k < n; k++) labelsOut[pixels[k]] = label;
    }
  }

  return blobs;
}
