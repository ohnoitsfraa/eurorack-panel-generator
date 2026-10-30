import { panelHeightMm, panelWidthMm } from './eurorack';
import type { DecorElement, Feature, PanelDesign } from './types';

/**
 * A panel for a module mounted upside down.
 *
 * Some modules can be fitted either way up, with a setting that turns their
 * display or their controls round to match. Its board is the same board
 * turned round, so every jack, pot and switch is where it was, rotated half a
 * turn about the panel's middle; a mirror image would line up with nothing.
 *
 * Lettering and artwork go with the parts they label but stay the right way
 * up, since the point of a flipped panel is a panel that still reads. A
 * label's alignment swaps sides, so it keeps covering the same stretch beside
 * the part it names.
 */
export function turnDesign(design: PanelDesign): PanelDesign {
  const W = panelWidthMm(design.hp), H = panelHeightMm(design.format);
  return {
    ...design,
    flipped: !design.flipped,
    features: design.features.map((f) => turnFeature(f, W, H)),
    decor: design.decor.map((d) => turnDecor(d, W, H)),
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A cutout half a turn about the panel's middle. A turned hole is the same hole. */
export function turnFeature(f: Feature, W: number, H: number): Feature {
  return { ...f, x: r2(W - f.x), y: r2(H - f.y) };
}

/** Decor moved with the panel, still upright; text keeps its stretch by swapping alignment. */
export function turnDecor(d: DecorElement, W: number, H: number): DecorElement {
  const moved = { ...d, x: r2(W - d.x), y: r2(H - d.y) };
  if (moved.type === 'text') {
    moved.align = moved.align === 'left' ? 'right' : moved.align === 'right' ? 'left' : 'center';
  }
  // A line is drawn, not read: a bent one turns with the panel, so it still
  // curves round whatever it curved round. Its ends already swap places.
  if (moved.type === 'shape' && moved.bend) {
    moved.bend = { ...moved.bend, x: -moved.bend.x, y: -moved.bend.y };
  }
  return moved;
}
