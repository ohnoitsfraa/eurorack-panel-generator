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
