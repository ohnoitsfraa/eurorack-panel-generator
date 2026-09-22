'use client';

import { HP_MM, PANEL_HEIGHTS, panelWidthMm, type PanelFormat } from './eurorack';
import { uid } from './types';

/**
 * Rack layout.
 *
 * A rack is rows of a fixed HP width holding panels at whole-HP offsets, which
 * is how real racks work: the rails are drilled on the 5.08 mm pitch and a
 * panel cannot sit between holes. Positions are therefore stored in HP, not
 * millimetres, and collisions are exact integer comparisons rather than
 * floating-point overlap tests.
 */

const KEY = 'eurorack-panel-generator/rack/v1';

/** Common case widths, plus whatever the user types. */
export const RACK_WIDTHS = [42, 48, 60, 84, 104, 126, 168] as const;

export interface Placement {
  id: string;
  /** Library design id. */
  designId: string;
  /** Left edge, in HP from the row's left rail. */
  hp: number;
}

export interface RackRow {
  id: string;
  /** Row capacity in HP. */
  widthHp: number;
  format: PanelFormat;
  placements: Placement[];
}

export interface Rack {
  name: string;
  rows: RackRow[];
  /** Epoch milliseconds of the last change, for sync. */
  updatedAt?: number;
}

export function emptyRow(widthHp = 84, format: PanelFormat = '3U'): RackRow {
  return { id: uid('r'), widthHp, format, placements: [] };
}

export function defaultRack(): Rack {
  return { name: 'My rack', rows: [emptyRow(), emptyRow()], updatedAt: 0 };
}

/** Stamp a rack as changed now. Every mutation goes through this. */
export function touchRack(rack: Rack): Rack {
  return { ...rack, updatedAt: Date.now() };
}

export function rowHeightMm(row: RackRow): number {
  return PANEL_HEIGHTS[row.format];
}

export function rowWidthMm(row: RackRow): number {
  return row.widthHp * HP_MM;
}

/** HP consumed in a row, ignoring gaps. */
export function usedHp(row: RackRow, widthOf: (designId: string) => number): number {
  return row.placements.reduce((n, p) => n + widthOf(p.designId), 0);
}

/**
 * Placements that overlap another, or hang off the end of the row.
 *
 * Returned as a set of placement ids so the view can mark them without
 * re-deriving the check per panel.
 */
export function conflicts(row: RackRow, widthOf: (designId: string) => number): Set<string> {
  const bad = new Set<string>();
  const spans = row.placements.map((p) => ({ id: p.id, a: p.hp, b: p.hp + widthOf(p.designId) }));

  for (const s of spans) {
    if (s.a < 0 || s.b > row.widthHp) bad.add(s.id);
  }
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i].a < spans[j].b && spans[j].a < spans[i].b) {
        bad.add(spans[i].id);
        bad.add(spans[j].id);
      }
    }
  }
  return bad;
}

/**
 * Leftmost free position of `width` HP in a row, or null if it will not fit.
 *
 * Walks the gaps between occupied spans in order, which keeps panels packed to
 * the left the way you would place them by hand.
 */
export function firstFreeHp(
  row: RackRow,
  width: number,
  widthOf: (designId: string) => number,
  ignoreId?: string,
): number | null {
  const spans = row.placements
    .filter((p) => p.id !== ignoreId)
    .map((p) => ({ a: p.hp, b: p.hp + widthOf(p.designId) }))
    .sort((x, y) => x.a - y.a);

  let cursor = 0;
  for (const s of spans) {
    if (s.a - cursor >= width) return cursor;
    cursor = Math.max(cursor, s.b);
  }
  return cursor + width <= row.widthHp ? cursor : null;
}

/**
 * Pixel height of a row drawn at `pxPerHp`.
 *
 * Derived from the row's real height rather than chosen to look tidy: one HP
 * is 5.08 mm, so a pixel scale expressed per HP is also a scale per
 * millimetre, and the row's height follows from it. Scaling this independently
 * of the width — which an earlier version did, to keep rows compact — stretches
 * every panel in the row by the inverse of the fudge.
 */
export function rowHeightPx(row: RackRow, pxPerHp: number): number {
  return (PANEL_HEIGHTS[row.format] / HP_MM) * pxPerHp;
}

/** Width divided by height for a panel, as it should appear. */
export function panelAspect(hp: number, format: PanelFormat): number {
  return panelWidthMm(hp) / PANEL_HEIGHTS[format];
}

/**
 * Fraction of its HP slot that a panel actually fills.
 *
 * Panels are cut 0.3 mm narrow so they do not bind in the rack, so a panel is
 * very slightly narrower than the slot it occupies. Drawing that gap keeps the
 * seams between modules honest.
 */
export function panelSlotFill(hp: number): number {
  return panelWidthMm(hp) / (hp * HP_MM);
}

export function loadRack(): Rack | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r: unknown = JSON.parse(raw);
    if (!r || typeof r !== 'object') return null;
    const rack = r as Rack;
    if (!Array.isArray(rack.rows)) return null;
    return rack;
  } catch {
    return null;
  }
}

export function saveRack(rack: Rack): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...rack, updatedAt: rack.updatedAt ?? Date.now() }));
  } catch {
    // Not worth interrupting the user over; the rack is rebuildable.
  }
}
