import earcut from 'earcut';
import type { Mesh, Pt } from '../types';
import { cleanRing, ensureWinding, type Region, type Ring } from '../geom/poly';

/**
 * Triangle accumulator.
 *
 * Normals are computed per face and duplicated across the face's three
 * vertices: a panel is all flat faces and hard edges, so smoothing across
 * them would only make the preview look melted.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  /**
   * Add a triangle, with `fallback` used as the normal if the cross product
   * is too small to give a direction.
   *
   * A triangle whose three vertices are distinct but collinear has zero area
   * and no computable normal, yet it must still be kept. Triangulating a face
   * with several holes whose edges line up exactly — which is what a row of
   * letters sharing a baseline looks like — makes earcut bridge them with
   * collinear edges. Discarding the resulting slivers would leave their
   * neighbours' edges unpaired and the surface no longer closed, so they are
   * kept with the face's own normal. Slivers carry no volume and slicers
   * ignore them; a surface with a gap in it is the real problem.
   *
   * Triangles with two coincident vertices are a different matter: they
   * contribute a repeated edge rather than a missing one, and are dropped.
   */
  tri(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    fallback?: [number, number, number],
  ): void {
    if (same(a, b) || same(b, c) || same(a, c)) return;

    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);

    if (len < 1e-12) {
      if (!fallback) return;
      [nx, ny, nz] = fallback;
    } else {
      nx /= len; ny /= len; nz /= len;
    }

    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }

  build(name: string, color: string): Mesh {
    repairTJunctions(this.pos, this.nrm);
    return {
      name,
      color,
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
    };
  }
}

/**
 * Normalise a ring to a canonical vertex sequence and winding.
 *
 * Every consumer must go through this. Cleaning and re-winding in the other
 * order is not equivalent: dropping duplicates keeps whichever of a coincident
 * pair comes first, so reversing before cleaning can retain the *other* point
 * of the pair. The two rings then differ by a fraction of a micron, their
 * vertices no longer match, and a cap stops meeting the wall along its own
 * boundary.
 */
export function prepRing(r: Ring, ccw: boolean): Ring {
  return ensureWinding(cleanRing(r), ccw);
}

/**
 * Triangulate a region as a flat cap at height `z`.
 *
 * `faceUp` controls which way the normals point, and therefore the winding.
 * earcut emits triangles that follow the orientation of the outer ring, so a
 * CCW outer ring gives us a +Z face directly and a -Z face by reversing.
 */
export function addCap(mb: MeshBuilder, region: Region, z: number, faceUp: boolean): void {
  const coords: number[] = [];
  const holeIndices: number[] = [];

  const outer = prepRing(region.outer, true);
  for (const p of outer) coords.push(p.x, p.y);

  for (const h of region.holes) {
    const hole = prepRing(h, false);
    if (hole.length < 3) continue;
    holeIndices.push(coords.length / 2);
    for (const p of hole) coords.push(p.x, p.y);
  }

  const idx = earcut(coords, holeIndices.length ? holeIndices : undefined, 2);
  for (let i = 0; i < idx.length; i += 3) {
    const p = (k: number): [number, number, number] => [coords[k * 2], coords[k * 2 + 1], z];
    const a = p(idx[i]);
    const b = p(idx[i + 1]);
    const c = p(idx[i + 2]);
    const up: [number, number, number] = [0, 0, faceUp ? 1 : -1];
    if (faceUp) mb.tri(a, b, c, up);
    else mb.tri(a, c, b, up);
  }
}

/**
 * Vertical wall along a ring, between two heights.
 *
 * With a CCW outer ring the emitted normals point away from the enclosed
 * material; with a CW hole ring they point into the void. Both are "outward
 * from the solid", which is exactly the convention STL and 3MF expect, so one
 * routine covers outer boundaries and holes alike.
 */
export function addWall(mb: MeshBuilder, ring: Ring, z0: number, z1: number): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    if (Math.abs(p.x - q.x) < 1e-12 && Math.abs(p.y - q.y) < 1e-12) continue;
    const a0: [number, number, number] = [p.x, p.y, z0];
    const a1: [number, number, number] = [p.x, p.y, z1];
    const b0: [number, number, number] = [q.x, q.y, z0];
    const b1: [number, number, number] = [q.x, q.y, z1];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dl = Math.hypot(dx, dy) || 1;
    const out: [number, number, number] = [dy / dl, -dx / dl, 0];
    mb.tri(a0, b0, b1, out);
    mb.tri(a0, b1, a1, out);
  }
}

/** A closed, watertight prism: capped top and bottom, walled all round. */
export function addPrism(mb: MeshBuilder, regions: Region[], z0: number, z1: number): void {
  for (const region of regions) {
    addCap(mb, region, z1, true);
    addCap(mb, region, z0, false);
    addWall(mb, prepRing(region.outer, true), z0, z1);
    for (const h of region.holes) addWall(mb, prepRing(h, false), z0, z1);
  }
}

/**
 * The open-topped inverse of a prism: the walls and floor of a pocket milled
 * into a surface at `zTop`, going down to `zFloor`.
 *
 * Normals face into the pocket void, so this stitches directly onto a top cap
 * that has the same regions punched out of it.
 */
export function addPocket(mb: MeshBuilder, regions: Region[], zFloor: number, zTop: number): void {
  for (const region of regions) {
    // Floor faces up out of the pocket.
    addCap(mb, region, zFloor, true);
    // Walls reversed relative to a prism, so they face inward.
    addWall(mb, prepRing(region.outer, false), zFloor, zTop);
    for (const h of region.holes) addWall(mb, prepRing(h, true), zFloor, zTop);
  }
}

/**
 * Split T-junctions so the surface closes.
 *
 * A triangulator is free to span several collinear vertices with one long
 * edge. Two engraved letters sharing a baseline is enough to trigger it: the
 * face between them gets a single edge running the whole way, while the
 * letters' own edges divide the same line into shorter pieces. The area is
 * right and it looks correct, but the long edge has no partner, so the mesh is
 * not closed and slicers report it as non-manifold.
 *
 * The repair inserts the intervening vertices into the offending triangle and
 * re-fans it, which costs a handful of triangles and makes the result
 * independent of how the triangulator chose to cut things up.
 */
export function repairTJunctions(pos: number[], nrm: number[], maxPasses = 3): void {
  const QUANT = 1e5;
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;

  for (let pass = 0; pass < maxPasses; pass++) {
    // Directed edge census. A closed surface has every edge matched by its
    // reverse; anything unmatched is a candidate T-junction.
    const edges = new Set<string>();
    for (let i = 0; i < pos.length; i += 9) {
      const a = key(pos[i], pos[i + 1], pos[i + 2]);
      const b = key(pos[i + 3], pos[i + 4], pos[i + 5]);
      const c = key(pos[i + 6], pos[i + 7], pos[i + 8]);
      edges.add(`${a}|${b}`);
      edges.add(`${b}|${c}`);
      edges.add(`${c}|${a}`);
    }

    const suspects = new Map<string, [number, number, number]>();
    for (let i = 0; i < pos.length; i += 9) {
      const pts: Array<[number, number, number]> = [
        [pos[i], pos[i + 1], pos[i + 2]],
        [pos[i + 3], pos[i + 4], pos[i + 5]],
        [pos[i + 6], pos[i + 7], pos[i + 8]],
      ];
      const ks = pts.map((p) => key(p[0], p[1], p[2]));
      for (let e = 0; e < 3; e++) {
        const u = ks[e];
        const v = ks[(e + 1) % 3];
        if (!edges.has(`${v}|${u}`)) {
          suspects.set(u, pts[e]);
          suspects.set(v, pts[(e + 1) % 3]);
        }
      }
    }
    if (suspects.size === 0) return;

    const candidates = [...suspects.values()];
    const outPos: number[] = [];
    const outNrm: number[] = [];
    let changed = false;

    for (let i = 0; i < pos.length; i += 9) {
      const tri: Array<[number, number, number]> = [
        [pos[i], pos[i + 1], pos[i + 2]],
        [pos[i + 3], pos[i + 4], pos[i + 5]],
        [pos[i + 6], pos[i + 7], pos[i + 8]],
      ];
      const n: [number, number, number] = [nrm[i], nrm[i + 1], nrm[i + 2]];

      // Walk the triangle's boundary, inserting any vertex that lies on it.
      const boundary: Array<[number, number, number]> = [];
      let inserted = false;
      for (let e = 0; e < 3; e++) {
        const a = tri[e];
        const b = tri[(e + 1) % 3];
        boundary.push(a);
        const on = candidates
          .map((p) => ({ p, t: paramOnSegment(a, b, p) }))
          .filter((h) => h.t !== null) as Array<{ p: [number, number, number]; t: number }>;
        if (on.length) {
          on.sort((x, y) => x.t - y.t);
          for (const h of on) boundary.push(h.p);
          inserted = true;
        }
      }

      if (!inserted) {
        outPos.push(...pos.slice(i, i + 9));
        outNrm.push(...nrm.slice(i, i + 9));
        continue;
      }

      changed = true;
      // Fan from the first corner. Every new edge is interior to the original
      // triangle, so it pairs with its neighbour in the fan.
      for (let k = 1; k + 1 < boundary.length; k++) {
        outPos.push(
          boundary[0][0], boundary[0][1], boundary[0][2],
          boundary[k][0], boundary[k][1], boundary[k][2],
          boundary[k + 1][0], boundary[k + 1][1], boundary[k + 1][2],
        );
        outNrm.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
      }
    }

    if (!changed) return;
    pos.length = 0;
    nrm.length = 0;
    pos.push(...outPos);
    nrm.push(...outNrm);
  }
}

/**
 * Where `p` falls along segment a-b, or null if it is not strictly between the
 * endpoints and on the line.
 */
function paramOnSegment(
  a: [number, number, number],
  b: [number, number, number],
  p: [number, number, number],
): number | null {
  const EPS = 1e-6;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < EPS * EPS) return null;

  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / len2;
  if (t <= EPS || t >= 1 - EPS) return null;

  // Distance from the point to its projection on the line.
  const qx = a[0] + dx * t, qy = a[1] + dy * t, qz = a[2] + dz * t;
  const d2 = (p[0] - qx) ** 2 + (p[1] - qy) ** 2 + (p[2] - qz) ** 2;
  return d2 <= EPS * EPS ? t : null;
}

function same(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;
}

/** A copy of the mesh shifted in space. Normals are unchanged by translation. */
export function translateMesh(m: Mesh, dx: number, dy: number, dz = 0): Mesh {
  const positions = new Float32Array(m.positions.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    positions[i] = m.positions[i] + dx;
    positions[i + 1] = m.positions[i + 1] + dy;
    positions[i + 2] = m.positions[i + 2] + dz;
  }
  return { ...m, positions, normals: m.normals.slice() };
}

export function mergeMeshes(meshes: Mesh[], name: string, color: string): Mesh {
  let n = 0;
  for (const m of meshes) n += m.positions.length;
  const positions = new Float32Array(n);
  const normals = new Float32Array(n);
  let o = 0;
  for (const m of meshes) {
    positions.set(m.positions, o);
    normals.set(m.normals, o);
    o += m.positions.length;
  }
  return { name, color, positions, normals };
}

/** Panel space is y-down like a screen; the model is y-up. */
export function flipY(ring: Ring, heightMm: number): Ring {
  return ring.map((p: Pt) => ({ x: p.x, y: heightMm - p.y }));
}
