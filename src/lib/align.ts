/**
 * Alignment guides for dragging.
 *
 * Panels are built out of rows and columns — a column of knobs, a row of
 * jacks — and getting two things on the same axis by eye is the fiddliest part
 * of laying one out. While something is being dragged, its centre is compared
 * against everything else on the panel, and when it comes close to sharing an
 * axis with one of them it snaps onto it and a line is drawn showing what it
 * lined up with.
 *
 * Kept free of React and of millimetre-versus-pixel concerns so the behaviour
 * can be tested directly. The caller converts a screen tolerance into
 * millimetres, which is what makes the guides feel the same at any zoom.
 */

export interface AlignTarget {
  id: string;
  x: number;
  y: number;
  /** Half-width and half-height, so a guide can span the whole shape. */
  rx: number;
  ry: number;
}

export interface Guide {
  axis: 'x' | 'y';
  /** Where the line sits, in mm. */
  at: number;
  /** Extent of the line along the other axis, in mm. */
  from: number;
  to: number;
  /** A panel centre line reads differently from lining up with another cutout. */
  source: 'item' | 'panel';
}

export interface AlignResult {
  x: number;
  y: number;
  guides: Guide[];
}

/**
 * Snap a dragged centre onto any axis it nearly shares, and describe the
 * guides to draw.
 *
 * Each axis is decided on its own, so something can line up vertically with
 * one cutout and horizontally with another at the same time. Ties go to the
 * nearest; a panel centre line wins an exact tie because centring on the panel
 * is usually the stronger intention.
 */
export function alignTo(
  px: number,
  py: number,
  targets: AlignTarget[],
  panel: { w: number; h: number },
  toleranceMm: number,
  /** Half-size of the thing being dragged, so its own guide spans it too. */
  self: { rx: number; ry: number } = { rx: 0, ry: 0 },
): AlignResult {
  const guides: Guide[] = [];

  const best = (
    value: number,
    axis: 'x' | 'y',
  ): { at: number; matches: AlignTarget[]; source: 'item' | 'panel' } | null => {
    const centre = axis === 'x' ? panel.w / 2 : panel.h / 2;
    let chosen: number | null = null;
    let source: 'item' | 'panel' = 'item';
    let bestDist = toleranceMm;

    for (const t of targets) {
      const d = Math.abs((axis === 'x' ? t.x : t.y) - value);
      if (d < bestDist) { bestDist = d; chosen = axis === 'x' ? t.x : t.y; source = 'item'; }
    }
    // The panel's own centre line, on equal terms with everything else.
    const dCentre = Math.abs(centre - value);
    if (dCentre <= bestDist) { bestDist = dCentre; chosen = centre; source = 'panel'; }

    if (chosen === null) return null;
    const at = chosen;
    const matches = targets.filter((t) => Math.abs((axis === 'x' ? t.x : t.y) - at) < 1e-6);
    return { at, matches, source };
  };

  const vx = best(px, 'x');
  const vy = best(py, 'y');
  const x = vx ? vx.at : px;
  const y = vy ? vy.at : py;

  if (vx) {
    // Span from the highest to the lowest thing sharing this column,
    // including the dragged item at its snapped position.
    const ys = [y - self.ry, y + self.ry, ...vx.matches.flatMap((t) => [t.y - t.ry, t.y + t.ry])];
    guides.push({
      axis: 'x',
      at: vx.at,
      from: vx.source === 'panel' && vx.matches.length === 0 ? 0 : Math.min(...ys),
      to: vx.source === 'panel' && vx.matches.length === 0 ? panel.h : Math.max(...ys),
      source: vx.source,
    });
  }
  if (vy) {
    const xs = [x - self.rx, x + self.rx, ...vy.matches.flatMap((t) => [t.x - t.rx, t.x + t.rx])];
    guides.push({
      axis: 'y',
      at: vy.at,
      from: vy.source === 'panel' && vy.matches.length === 0 ? 0 : Math.min(...xs),
      to: vy.source === 'panel' && vy.matches.length === 0 ? panel.w : Math.max(...xs),
      source: vy.source,
    });
  }

  return { x, y, guides };
}

/** Round to a grid, for when nothing is close enough to align with. */
export function snapToGrid(v: number, gridMm: number): number {
  return gridMm > 0 ? Math.round(v / gridMm) * gridMm : Math.round(v * 100) / 100;
}
