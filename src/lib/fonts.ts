/**
 * Fonts offered in the UI.
 *
 * Also the allow-list the font route validates against, so the picker and the
 * server cannot drift apart. All are open-licensed and available as TrueType.
 */
export const FONT_FAMILIES = [
  'Archivo', 'Archivo Narrow', 'Barlow', 'Barlow Condensed', 'Chivo',
  'DM Mono', 'DM Sans', 'Fira Code', 'Fira Sans', 'IBM Plex Mono',
  'IBM Plex Sans', 'Inter', 'JetBrains Mono', 'Lato', 'Manrope',
  'Montserrat', 'Nunito Sans', 'Open Sans', 'Oswald', 'Roboto',
  'Roboto Condensed', 'Roboto Mono', 'Rubik', 'Saira Condensed',
  'Source Code Pro', 'Space Mono', 'Work Sans',
] as const;

export const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;

/**
 * The weights a family actually comes in, where that is not all of them.
 *
 * Google Fonts answers a weight a family does not have with an error, so
 * offering 900 for Space Mono offered a label that would never draw. Taken
 * from what the font service serves; a family not listed has every weight.
 */
const FAMILY_WEIGHTS: Partial<Record<string, readonly number[]>> = {
  'Archivo Narrow': [400, 500, 600, 700],
  'DM Mono': [300, 400, 500],
  'Fira Code': [300, 400, 500, 600, 700],
  'IBM Plex Mono': [300, 400, 500, 600, 700],
  'IBM Plex Sans': [300, 400, 500, 600, 700],
  'JetBrains Mono': [300, 400, 500, 600, 700, 800],
  Lato: [300, 400, 700, 900],
  Manrope: [300, 400, 500, 600, 700, 800],
  'Open Sans': [300, 400, 500, 600, 700, 800],
  Oswald: [300, 400, 500, 600, 700],
  'Roboto Mono': [300, 400, 500, 600, 700],
  'Space Mono': [400, 700],
};

/** The weights to offer for a family. An uploaded font answers for all of them. */
export function weightsFor(family: string): readonly number[] {
  return FAMILY_WEIGHTS[family] ?? FONT_WEIGHTS;
}

/**
 * The weight a family can actually draw nearest to the one asked for: the
 * heavier of two equally near, since lettering on a panel errs bold.
 */
export function nearestWeight(family: string, weight: number): number {
  const ws = weightsFor(family);
  return ws.reduce((best, w) => {
    const d = Math.abs(w - weight), bd = Math.abs(best - weight);
    return d < bd || (d === bd && w > best) ? w : best;
  });
}

/**
 * The family name an uploaded font is stored under.
 *
 * A file named after a built-in family gets " (uploaded)", so Inter.ttf cannot
 * quietly stand in for the Inter everyone else's copy of a panel will fetch.
 * A name some other uploaded font already has gets a number, "Name (2)", so a
 * different file never replaces the one existing lettering is set in.
 */
export function uploadedFontName(wanted: string, taken: Iterable<string>): string {
  const base = (FONT_FAMILIES as readonly string[]).includes(wanted) ? `${wanted} (uploaded)` : wanted;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
