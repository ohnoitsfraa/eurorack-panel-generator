import { zipSync, strToU8 } from 'fflate';
import type { Mesh } from '../types';

/**
 * 3MF writer.
 *
 * Unlike STL this keeps objects separate and carries colour, which is the
 * whole reason the app offers it: a panel with raised white legends and a
 * black body arrives in the slicer as two objects already assigned to two
 * materials. Colours ride in the core <basematerials> element rather than an
 * extension, because that is what PrusaSlicer, OrcaSlicer, Bambu Studio and
 * Cura all agree on.
 */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

export interface ThreeMFOptions {
  title?: string;
  /** Weld vertices within this distance, mm. Set to 0 to keep the raw soup. */
  weldTolerance?: number;
}

export function meshesTo3MF(meshes: Mesh[], opts: ThreeMFOptions = {}): Uint8Array {
  const { title = 'Eurorack panel', weldTolerance = 1e-4 } = opts;
  const used = meshes.filter((m) => m.positions.length > 0);

  // One material per distinct colour, referenced by index.
  const colors: string[] = [];
  for (const m of used) {
    const c = normaliseColor(m.color);
    if (!colors.includes(c)) colors.push(c);
  }

  const materials = colors
    .map((c, i) => `      <base name="Colour ${i + 1}" displaycolor="${c}"/>`)
    .join('\n');

  const objects: string[] = [];
  const items: string[] = [];

  used.forEach((mesh, i) => {
    const objId = i + 2; // id 1 is the basematerials group
    const { vertices, triangles } = weld(mesh, weldTolerance);

    const vXml = vertices
      .map((v) => `<vertex x="${fmt(v[0])}" y="${fmt(v[1])}" z="${fmt(v[2])}"/>`)
      .join('');
    const tXml = triangles
      .map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`)
      .join('');

    const pindex = colors.indexOf(normaliseColor(mesh.color));
    objects.push(
      `    <object id="${objId}" type="model" pid="1" pindex="${pindex}" name="${escapeXml(mesh.name)}">\n` +
      `      <mesh><vertices>${vXml}</vertices><triangles>${tXml}</triangles></mesh>\n` +
      `    </object>`,
    );
    items.push(`    <item objectid="${objId}"/>`);
  });

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${escapeXml(title)}</metadata>
  <metadata name="Application">Panelmate</metadata>
  <resources>
    <basematerials id="1">
${materials}
    </basematerials>
${objects.join('\n')}
  </resources>
  <build>
${items.join('\n')}
  </build>
</model>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELS),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  );
}

/**
 * Collapse the triangle soup into indexed vertices.
 *
 * Our builder emits three fresh vertices per face, which triples the file size
 * and leaves the mesh formally non-manifold even when the geometry is sound.
 * Snapping to a tolerance grid and reusing matches fixes both.
 */
function weld(
  mesh: Mesh,
  tol: number,
): { vertices: Array<[number, number, number]>; triangles: Array<[number, number, number]> } {
  const vertices: Array<[number, number, number]> = [];
  const triangles: Array<[number, number, number]> = [];
  const map = new Map<string, number>();
  const q = tol > 0 ? 1 / tol : 0;

  const indexOf = (x: number, y: number, z: number): number => {
    if (q === 0) {
      vertices.push([x, y, z]);
      return vertices.length - 1;
    }
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    const hit = map.get(key);
    if (hit !== undefined) return hit;
    vertices.push([x, y, z]);
    const id = vertices.length - 1;
    map.set(key, id);
    return id;
  };

  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 9) {
    const a = indexOf(p[i], p[i + 1], p[i + 2]);
    const b = indexOf(p[i + 3], p[i + 4], p[i + 5]);
    const c = indexOf(p[i + 6], p[i + 7], p[i + 8]);
    // Welding can pull a thin sliver into a line; drop those rather than
    // shipping a zero-area triangle that some slicers reject outright.
    if (a === b || b === c || a === c) continue;
    triangles.push([a, b, c]);
  }
  return { vertices, triangles };
}

/** 3MF wants #RRGGBB or #RRGGBBAA, uppercase. */
function normaliseColor(c: string): string {
  let hex = c.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
  if (hex.length === 6) hex += 'FF';
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) hex = '808080FF';
  return `#${hex.toUpperCase()}`;
}

function fmt(v: number): string {
  // Six decimals is well under printer resolution and keeps the XML compact.
  return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '0';
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string,
  );
}
