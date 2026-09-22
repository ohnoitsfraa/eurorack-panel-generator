/**
 * Colour helpers for drawing the panel.
 *
 * A cutout is a hole, and what a hole should look like depends on the panel it
 * is in rather than on the interface around it. Painted the same dark tone
 * always, a hole in a black faceplate is invisible — which was true long
 * before there was a light theme to notice it in.
 */

export function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Relative luminance, as the contrast formulae define it. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Near-black, used whenever a dark hole can be seen against the panel. */
const HOLE_DARK = '#101216';

/** The contrast a cutout must reach against its panel. */
const TARGET_RATIO = 5;

/** A neutral grey of a given relative luminance. */
function greyOfLuminance(target: number): string {
  const l = Math.max(0, Math.min(1, target));
  // Invert the sRGB transfer curve to get the channel value back.
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  const v = Math.round(Math.max(0, Math.min(1, c)) * 255);
  const h = v.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

/**
 * What to paint a cutout, given the colour of the panel around it.
 *
 * Holes are dark in life, so a dark one is used wherever it can actually be
 * seen. On a dark panel it cannot, so the hole goes the other way — and by how
 * much is calculated rather than guessed: a fixed light grey was legible on
 * black but only reached 3.3:1 against a dark green, which is the sort of gap
 * that is invisible until someone tries that exact colour. The lightness is
 * solved for from the contrast formula instead, so every panel colour works.
 *
 * Legibility beats realism while laying a panel out; the 3D preview shows the
 * true article.
 */
export function cutoutFill(panelColor: string): string {
  const l = luminance(panelColor);
  // Can a dark hole reach the target against this panel?
  const darkest = (l + 0.05) / TARGET_RATIO - 0.05;
  if (darkest >= luminance(HOLE_DARK)) return HOLE_DARK;
  // It cannot, so go lighter by exactly as much as is needed.
  return greyOfLuminance(TARGET_RATIO * (l + 0.05) - 0.05);
}
