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
