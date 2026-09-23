import type { Font } from 'opentype.js';
import { HP_MM, PANEL_HEIGHTS, panelWidthMm } from '../eurorack';
import type { Mesh } from '../types';
import type { Rack } from '../rack';
import type { SavedDesign } from '../storage';
import { buildPanel } from './build';
import { translateMesh } from './mesh';

export interface RackBuildResult {
  meshes: Mesh[];
  warnings: string[];
  /** Families still on their way; see BuildResult.pending. */
  pending: string[];
  stats: { panels: number; triangles: number; widthMm: number; heightMm: number };
}

/**
 * Build every panel in the rack, positioned as it sits in the rack.
 *
 * Laid out in rack coordinates rather than packed for a print bed: this is the
 * arrangement that lets you check the whole front at once, and a slicer can
 * rearrange objects far better than a bin-packing guess made here. A full 84 HP
 * row is 427 mm wide, so the caller should say as much.
 *
 * Each design is built once and reused across its placements, because the same
 * panel appearing four times in a rack should cost one triangulation.
 */
export function buildRack(
  rack: Rack,
  library: SavedDesign[],
  fonts: Map<string, Font>,
): RackBuildResult {
  const byId = new Map(library.map((d) => [d.id, d]));
  const cache = new Map<string, ReturnType<typeof buildPanel>>();
  const meshes: Mesh[] = [];
  const warnings: string[] = [];
  const pending: string[] = [];

  const rowHeights = rack.rows.map((r) => PANEL_HEIGHTS[r.format]);
  const totalH = rowHeights.reduce((a, b) => a + b, 0);
  const totalW = Math.max(0, ...rack.rows.map((r) => r.widthHp * HP_MM));

  let panels = 0;
  let topOffset = 0;

  for (let i = 0; i < rack.rows.length; i++) {
    const row = rack.rows[i];
    const rowH = rowHeights[i];
    // Panels are built with their origin at the bottom-left in a y-up frame,
    // so a row's vertical offset is measured from the bottom of the rack.
    const yBase = totalH - topOffset - rowH;

    for (const p of row.placements) {
      const saved = byId.get(p.designId);
      if (!saved) {
        warnings.push('A panel in the rack is missing from the library and was left out.');
        continue;
      }

      let built = cache.get(p.designId);
      if (!built) {
        built = buildPanel(saved.design, { fonts });
        cache.set(p.designId, built);
        for (const w of built.warnings) warnings.push(`${saved.name}: ${w}`);
        // Not prefixed with the panel: which panel is waiting on Inter is of
        // no use to anyone, and the same font would be listed once per panel.
        pending.push(...built.pending);
      }

      const dx = p.hp * HP_MM;
      for (const m of built.meshes) {
        meshes.push({ ...translateMesh(m, dx, yBase), name: `${saved.name} / ${m.name}` });
      }
      panels++;
    }
    topOffset += rowH;
  }

  const triangles = meshes.reduce((n, m) => n + m.positions.length / 9, 0);
  return { meshes, warnings, pending: [...new Set(pending)], stats: { panels, triangles, widthMm: totalW, heightMm: totalH } };
}

/** Width in millimetres of a saved design, for layout maths. */
export function designWidthMm(saved: SavedDesign): number {
  return panelWidthMm(saved.design.hp);
}
