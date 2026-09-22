import type { Font } from 'opentype.js';
import { COMPONENT_SPECS, mountSlotPositions, panelHeightMm, panelWidthMm, MOUNT_SLOT } from '../eurorack';
import type { DecorElement, Feature, Mesh, PanelDesign } from '../types';
import {
  circleRing, ensureWinding, nestRings, pointInRing, ringsOverlap,
  roundedRectRing, signedArea, slotRing, type Region, type Ring,
} from '../geom/poly';
import { cleanRegions, intersectRegions, subtractRegions } from '../geom/boolean';
import { MeshBuilder, addCap, addPocket, addPrism, addWall, flipY, prepRing } from './mesh';
import { textToRings } from './text';
import { shapeRingsForPreview as shapeRings } from './preview';

/**
 * Raised decor is sunk this far into the panel face.
 *
 * Slicers deal with overlapping solids cleanly but are inconsistent about
 * exactly coincident faces, so a deliberate sliver of interference is safer
 * than a perfect butt joint.
 */
const EMBED_MM = 0.05;

/**
 * Material left between an engraving and any cutout or the panel edge.
 *
 * Two purposes. Physically, an engraving running exactly into a jack hole
 * leaves a fragile knife edge. Geometrically, it keeps the pocket's boundary
 * from ever coinciding with a cutout's boundary, which would give the
 * triangulator two holes sharing an edge — degenerate input that comes back as
 * duplicated faces.
 */
const ENGRAVE_CLEARANCE_MM = 0.25;

export interface BuildResult {
  meshes: Mesh[];
  warnings: string[];
  stats: { widthMm: number; heightMm: number; triangles: number; holes: number };
}

export interface BuildOptions {
  /** Fonts keyed by `${family}@${weight}`; text elements without one are skipped. */
  fonts: Map<string, Font>;
}

export function buildPanel(design: PanelDesign, opts: BuildOptions): BuildResult {
  const warnings: string[] = [];
  const W = panelWidthMm(design.hp);
  const H = panelHeightMm(design.format);
  const t = design.thicknessMm;

  const outline = roundedRectRing(W / 2, H / 2, W, H, design.cornerRadiusMm);
  const holes: Ring[] = [];

  for (const f of design.features) {
    const ring = featureRing(f);
    if (ring) holes.push(ring);
  }

  if (design.includeMountSlots) {
    for (const p of mountSlotPositions(W, H)) {
      holes.push(slotRing(p.x, p.y, MOUNT_SLOT.heightMm, MOUNT_SLOT.lengthMm, 0));
    }
  }

  // Everything below works in a y-up frame so that the mesh sits the right way
  // up in the preview and in a slicer.
  const up = (r: Ring) => flipY(r, H);
  const outlineUp = ensureWinding(up(outline), true);
  const holesUp = holes.map((r) => ensureWinding(up(r), false));

  // Overlapping cutouts still produce correct geometry now that the profile is
  // built with real boolean operations, but it is almost always a mistake, so
  // say so rather than quietly merging two jacks into a peanut.
  for (const [i, j] of overlappingPairs(holesUp)) {
    warnings.push(
      `Cutouts ${describeHole(design, i)} and ${describeHole(design, j)} overlap. ` +
      `They will be merged into a single opening.`,
    );
  }

  // The panel's material profile: the outline with every cutout removed.
  const panelProfile = subtractRegions(
    [{ outer: outlineUp, holes: [] }],
    holesUp.map((r) => ({ outer: r, holes: [] })),
  );

  // The same profile pulled in by the engraving clearance. Engravings are
  // clipped against this rather than the real profile, so a pocket can never
  // share an edge with a cutout.
  const m = ENGRAVE_CLEARANCE_MM;
  const safeOutline = ensureWinding(
    up(roundedRectRing(W / 2, H / 2, W - 2 * m, H - 2 * m, Math.max(0, design.cornerRadiusMm - m))),
    true,
  );
  const grownHoles: Ring[] = [];
  for (const f of design.features) {
    const ring = featureRing(f, m);
    if (ring) grownHoles.push(ensureWinding(up(ring), false));
  }
  if (design.includeMountSlots) {
    for (const p of mountSlotPositions(W, H)) {
      grownHoles.push(ensureWinding(
        up(slotRing(p.x, p.y, MOUNT_SLOT.heightMm + 2 * m, MOUNT_SLOT.lengthMm + 2 * m, 0)),
        false,
      ));
    }
  }
  const engraveProfile = subtractRegions(
    [{ outer: safeOutline, holes: [] }],
    grownHoles.map((r) => ({ outer: r, holes: [] })),
  );

  const decor = resolveDecor(design, opts, warnings);
  const engravedGroups: Array<{ regions: Region[]; depth: number; color: string }> = [];
  const raisedMeshes: Mesh[] = [];
  // Engraved areas already claimed, so two overlapping engravings at different
  // depths cannot both cut the same material.
  let claimed: Region[] = [];

  for (const d of decor) {
    const ringsUp = d.rings.map(up);
    if (ringsUp.length === 0) continue;

    // cleanRegions resolves the self-overlap that font outlines legitimately
    // contain; without it a glyph such as "V" triangulates into nonsense.
    const regions = cleanRegions(nestRings(ringsUp));
    if (regions.length === 0) continue;

    if (d.mode !== 'engraved') {
      const mb = new MeshBuilder();
      addPrism(mb, regions, t - EMBED_MM, t + d.reliefMm);
      if (mb.triangleCount > 0) raisedMeshes.push(mb.build(d.label, d.color));
      continue;
    }

    const depth = Math.min(d.reliefMm, t - 0.4); // always leave a floor to print on
    if (depth <= 0) {
      warnings.push(`"${d.label}" is deeper than the panel is thick, so it was skipped.`);
      continue;
    }

    // Clip to material that is actually there and not already engraved.
    const inMaterial = intersectRegions(regions, engraveProfile);
    const clipped = claimed.length ? subtractRegions(inMaterial, claimed) : inMaterial;

    if (clipped.length === 0) {
      warnings.push(`"${d.label}" lies entirely over a cutout or off the panel, so it was skipped.`);
      continue;
    }
    if (areaOf(clipped) < areaOf(regions) * 0.99) {
      warnings.push(`"${d.label}" crosses a cutout or the panel edge and was trimmed to fit.`);
    }

    engravedGroups.push({ regions: clipped, depth, color: d.color });
    claimed = claimed.length ? cleanRegions([...claimed, ...clipped]) : clipped;
  }

  // --- the panel itself ---
  const panel = new MeshBuilder();

  for (const region of panelProfile) {
    // The underside and the outer walls are the same whether or not anything
    // is engraved into the face.
    addCap(panel, region, 0, false);
    addWall(panel, prepRing(region.outer, true), 0, t);
    for (const h of region.holes) addWall(panel, prepRing(h, false), 0, t);

    // The top face carries the engravings as additional holes. Because each
    // engraved group was already clipped to the material, its rings can be
    // used directly here rather than run through another boolean, which is
    // what guarantees the pocket walls meet this cap exactly.
    const sunken = engravedGroups
      .flatMap((g) => g.regions)
      .filter((r) => regionSitsIn(r, region));

    addCap(
      panel,
      { outer: region.outer, holes: [...region.holes, ...sunken.map((r) => r.outer)] },
      t,
      true,
    );

    // A counter inside an engraved glyph stays at full height: its own island.
    for (const r of sunken) {
      for (const hole of r.holes) addCap(panel, { outer: hole, holes: [] }, t, true);
    }
  }

  for (const g of engravedGroups) addPocket(panel, g.regions, t - g.depth, t);

  const meshes: Mesh[] = [panel.build('panel', design.backgroundColor)];

  // A pocket in a differently coloured decor element gets a matching inlay
  // solid, which is how a two-material printer fills an engraving. When the
  // colours match there is nothing to fill and the pocket stays open.
  for (const g of engravedGroups) {
    if (g.color.toLowerCase() === design.backgroundColor.toLowerCase()) continue;
    const mb = new MeshBuilder();
    addPrism(mb, g.regions, t - g.depth, t);
    if (mb.triangleCount > 0) meshes.push(mb.build('inlay', g.color));
  }

  meshes.push(...raisedMeshes);

  const triangles = meshes.reduce((n, m) => n + m.positions.length / 9, 0);
  return {
    meshes,
    warnings,
    stats: { widthMm: W, heightMm: H, triangles, holes: holesUp.length },
  };
}

/** Indices of every pair of rings that intersect. */
function overlappingPairs(rings: Ring[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      if (ringsOverlap(rings[i], rings[j])) out.push([i, j]);
    }
  }
  return out;
}

/** Name a cutout by its component, falling back to the mounting slots. */
function describeHole(design: PanelDesign, index: number): string {
  const f = design.features[index];
  if (f) return `"${COMPONENT_SPECS[f.kind].label}" at ${f.x.toFixed(1)}, ${f.y.toFixed(1)} mm`;
  return 'a mounting slot';
}

/**
 * Outline of a cutout. `margin` grows it on every side, which is how the
 * engraving clearance zone is built.
 */
export function featureRing(f: Feature, margin = 0): Ring | null {
  if (f.d <= 0) return null;
  const d = f.d + 2 * margin;
  const len = Math.max(f.len ?? f.d, f.d) + 2 * margin;
  switch (f.shape) {
    case 'circle':
      return circleRing(f.x, f.y, d);
    case 'slot':
      return slotRing(f.x, f.y, d, len, f.rotation ?? 0);
    case 'rect':
      return roundedRectRing(f.x, f.y, d, (f.len ?? f.d) + 2 * margin, (f.radius ?? 0) + margin, f.rotation ?? 0);
    default:
      return null;
  }
}

interface ResolvedDecor {
  label: string;
  rings: Ring[];
  mode: 'raised' | 'engraved';
  reliefMm: number;
  color: string;
}

function resolveDecor(design: PanelDesign, opts: BuildOptions, warnings: string[]): ResolvedDecor[] {
  const out: ResolvedDecor[] = [];

  for (const el of design.decor) {
    const common = { mode: el.mode, reliefMm: el.reliefMm, color: el.color };

    if (el.type === 'text') {
      const font = opts.fonts.get(`${el.fontFamily}@${el.fontWeight}`);
      if (!font) {
        warnings.push(`Font "${el.fontFamily}" is still loading, so "${el.text}" was left out.`);
        continue;
      }
      out.push({ ...common, label: `text: ${el.text.slice(0, 24)}`, rings: textToRings(el, font) });
    } else if (el.type === 'art') {
      out.push({ ...common, label: 'artwork', rings: el.rings });
    } else {
      out.push({ ...common, label: `shape: ${el.shape}`, rings: shapeRings(el) });
    }
  }
  return out;
}

/** Total absolute area of a region set. */
function areaOf(regions: Region[]): number {
  let a = 0;
  for (const r of regions) {
    a += Math.abs(signedArea(r.outer));
    for (const h of r.holes) a -= Math.abs(signedArea(h));
  }
  return a;
}

/** Is this region inside that one? Rings do not cross, so one vertex decides. */
function regionSitsIn(inner: Region, outer: Region): boolean {
  return inner.outer.length > 0 && pointInRing(inner.outer[0], outer.outer);
}
