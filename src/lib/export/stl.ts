import type { Mesh } from '../types';

/**
 * Binary STL.
 *
 * The format carries no colour and no notion of separate objects, so callers
 * that care about either should reach for 3MF. Every triangle stores its own
 * normal, which we already have per face.
 */
export function meshesToBinarySTL(meshes: Mesh[], header = 'eurorack-panel'): ArrayBuffer {
  let tris = 0;
  for (const m of meshes) tris += m.positions.length / 9;

  const buf = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // 80-byte header. Must not begin with "solid" or parsers guess ASCII.
  const text = new TextEncoder().encode(header.slice(0, 79));
  bytes.set(text, 0);
  view.setUint32(80, tris, true);

  let o = 84;
  for (const m of meshes) {
    const p = m.positions;
    const n = m.normals;
    for (let i = 0; i < p.length; i += 9) {
      // One normal per facet: take the first vertex's, they are all equal.
      view.setFloat32(o, n[i], true);
      view.setFloat32(o + 4, n[i + 1], true);
      view.setFloat32(o + 8, n[i + 2], true);
      o += 12;
      for (let v = 0; v < 9; v += 3) {
        view.setFloat32(o, p[i + v], true);
        view.setFloat32(o + 4, p[i + v + 1], true);
        view.setFloat32(o + 8, p[i + v + 2], true);
        o += 12;
      }
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return buf;
}
