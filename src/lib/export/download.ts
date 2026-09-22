import { zipSync } from 'fflate';
import type { Mesh } from '../types';
import { meshesToBinarySTL } from './stl';
import { meshesTo3MF } from './threemf';

export function triggerDownload(data: ArrayBuffer | Uint8Array, filename: string, mime: string): void {
  // Copy into a plain ArrayBuffer: fflate hands back a Uint8Array whose buffer
  // is typed as ArrayBufferLike, which Blob will not accept directly.
  const part: ArrayBuffer =
    data instanceof ArrayBuffer
      ? data
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([part], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadSTL(meshes: Mesh[], name: string): void {
  triggerDownload(meshesToBinarySTL(meshes, name), `${name}.stl`, 'model/stl');
}

export function download3MF(meshes: Mesh[], name: string): void {
  const u8 = meshesTo3MF(meshes, { title: name });
  triggerDownload(u8, `${name}.3mf`, 'model/3mf');
}

/**
 * One STL per colour, zipped.
 *
 * STL cannot express colour, so a multi-colour panel only survives the round
 * trip as separate files the user loads as separate objects. Meshes are
 * grouped by colour rather than by name so a panel with six white labels
 * produces one white file, not six.
 */
export function downloadSTLSet(meshes: Mesh[], name: string): void {
  const byColor = new Map<string, Mesh[]>();
  for (const m of meshes) {
    const list = byColor.get(m.color);
    if (list) list.push(m); else byColor.set(m.color, [m]);
  }

  const files: Record<string, Uint8Array> = {};
  let i = 1;
  for (const [color, group] of byColor) {
    const slug = color.replace(/[^0-9a-zA-Z]/g, '') || `part${i}`;
    files[`${name}-${i}-${slug}.stl`] = new Uint8Array(meshesToBinarySTL(group, `${name} ${slug}`));
    i++;
  }
  triggerDownload(zipSync(files, { level: 6 }), `${name}-stl-set.zip`, 'application/zip');
}
