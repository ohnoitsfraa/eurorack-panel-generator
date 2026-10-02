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
  /**
   * How far the dragged thing has ended up from its nearest neighbour on this
   * line, and where the two of them sit along it.
   *
   * Lining two things up is only half of placing them; the other half is how
   * far apart they are, and that is a number panels are actually built to —
   * jacks at 15 mm centres, a row of knobs evenly spread. Measured centre to
   * centre, which is how hardware spacing is quoted.
   *
   * Absent when the line is the panel's own centre with nothing else on it:
   * there is no neighbour to be any distance from.
   */
  gap?: { from: number; to: number; mm: number };
}

/**
 * Equal spacing along a row or a column.
 *
 * Once two things in a row are a certain distance apart, the third is nearly
 * always meant to be the same distance on: jacks at 15 mm, knobs evenly
 * spread. So the spacings already on the line are offered as snaps, and so is
 * the point halfway between two neighbours. Every interval of that size on
 * the line is marked, so it is plain which spacing is being repeated.
 */
export interface SpacingHint {
  /** The direction the spacing runs: 'x' along a row, 'y' down a column. */
  axis: 'x' | 'y';
  /** Where the row or column sits across that direction, in mm. */
  at: number;
  /** The spacing, centre to centre, in mm. */
  mm: number;
  /** Half the size of the biggest thing on the line, so marks can clear it. */
  clearance: number;
  /** Each interval of that spacing on the line, the new one included. */
  spans: Array<{ from: number; to: number }>;
}

export interface AlignResult {
  x: number;
  y: number;
  guides: Guide[];
  spacing: SpacingHint[];
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

  let vx = best(px, 'x');
  let vy = best(py, 'y');
  let x = vx ? vx.at : px;
  let y = vy ? vy.at : py;

  // Equal spacing, along a row the item has lined up with and then down a
  // column. Lining up exactly with something wins a tie: it is the more
  // specific intention, and the same spacing is often exactly there anyway.
  const spacing: SpacingHint[] = [];
  const row = vy && vy.matches.length >= 2 ? equalSpacing(px, vy.matches.map((t) => t.x), toleranceMm) : null;
  if (row && (!vx || Math.abs(row.at - px) < Math.abs(vx.at - px))) {
    x = row.at;
    vx = null;
    spacing.push({ axis: 'x', at: y, mm: row.mm, spans: row.spans, clearance: Math.max(self.ry, ...vy!.matches.map((t) => t.ry)) });
  } else {
    const col = vx && vx.matches.length >= 2 ? equalSpacing(py, vx.matches.map((t) => t.y), toleranceMm) : null;
    if (col && (!vy || Math.abs(col.at - py) < Math.abs(vy.at - py))) {
      y = col.at;
      vy = null;
      spacing.push({ axis: 'y', at: x, mm: col.mm, spans: col.spans, clearance: Math.max(self.rx, ...vx!.matches.map((t) => t.rx)) });
    }
  }
  // A line whose spacing is drawn interval by interval needs no second figure.
  const spaced = (axis: 'x' | 'y') => spacing.some((s) => s.axis === axis);

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
      gap: spaced('y') ? undefined : gapTo(y, vx.matches.map((t) => t.y)),
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
      gap: spaced('x') ? undefined : gapTo(x, vy.matches.map((t) => t.x)),
    });
  }

  return { x, y, guides, spacing };
}

/**
 * The nearest place on a line that repeats a spacing already on it, or that
 * sits halfway between two neighbours.
 *
 * A spacing is offered on from any item, as long as nothing else on the line
 * sits in between: the next jack in a row goes after the last one, not on
 * top of the second.
 */
export function equalSpacing(
  value: number,
  others: number[],
  toleranceMm: number,
): { at: number; mm: number; spans: Array<{ from: number; to: number }> } | null {
  const ps = [...others].sort((a, b) => a - b);
  const pairs: Array<{ from: number; to: number; mm: number }> = [];
  for (let i = 0; i + 1 < ps.length; i++) {
    const mm = ps[i + 1] - ps[i];
    if (mm > 0.05) pairs.push({ from: ps[i], to: ps[i + 1], mm });
  }
  if (!pairs.length) return null;

  // Nothing else between an item and the place a spacing on from it lands,
  // or already at that place.
  const clear = (from: number, at: number) => {
    const lo = Math.min(from, at), hi = Math.max(from, at);
    return !ps.some((p) => p !== from && p > lo - 1e-6 && p < hi + 1e-6);
  };
  const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

  let best: { at: number; mm: number; spans: Array<{ from: number; to: number }> } | null = null;
  let bestDist = toleranceMm;
  const consider = (at: number, mm: number, spans: Array<{ from: number; to: number }>) => {
    const d = Math.abs(at - value);
    if (d < bestDist) { bestDist = d; best = { at, mm, spans }; }
  };

  const gaps = pairs.map((p) => p.mm).filter((g, i, all) => all.findIndex((h) => same(g, h)) === i);
  for (const mm of gaps) {
    const existing = pairs.filter((p) => same(p.mm, mm)).map(({ from, to }) => ({ from, to }));
    for (const q of ps) {
      for (const at of [q + mm, q - mm]) {
        if (!clear(q, at)) continue;
        consider(at, mm, [...existing, { from: Math.min(q, at), to: Math.max(q, at) }]);
      }
    }
  }
  // Halfway between two neighbours: two equal intervals of its own.
  for (const p of pairs) {
    const at = (p.from + p.to) / 2;
    consider(at, p.mm / 2, [{ from: p.from, to: at }, { from: at, to: p.to }]);
  }
  return best;
}

/**
 * Distance from the dragged centre to the nearest neighbour on the same line.
 *
 * The nearest rather than all of them: a column of eight jacks would otherwise
 * carry eight numbers, and the one being placed is being placed against the
 * thing next to it. Two centres in the same place is nothing worth measuring —
 * that is a cutout dropped on top of another, which has its own complaint.
 */
function gapTo(value: number, others: number[]): { from: number; to: number; mm: number } | undefined {
  let nearest: number | null = null;
  let best = Infinity;
  for (const o of others) {
    const d = Math.abs(o - value);
    if (d > 0.05 && d < best) { best = d; nearest = o; }
  }
  return nearest === null ? undefined : { from: value, to: nearest, mm: best };
}

/** Round to a grid, for when nothing is close enough to align with. */
export function snapToGrid(v: number, gridMm: number): number {
  return gridMm > 0 ? Math.round(v / gridMm) * gridMm : Math.round(v * 100) / 100;
}
