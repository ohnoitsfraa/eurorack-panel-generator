'use client';

/**
 * Light, dark, or whatever the system is set to.
 *
 * The choice is written to `data-theme` on the document element, which the
 * stylesheet keys off, and mirrored into React state for the parts that cannot
 * read CSS — the 3D preview builds its colours in JavaScript.
 *
 * Stored in localStorage rather than IndexedDB, because it has to be read
 * before the first paint to avoid a flash of the wrong theme, and that has to
 * happen synchronously.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

// Unchanged across the rename, so nobody's chosen theme resets.
export const THEME_KEY = 'eurorack-panel-generator/theme';

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage blocked; the choice lasts for this page only.
  }
}

export function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolve(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolve(choice);
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  // Tells the browser which way to render form controls and scrollbars.
  root.style.colorScheme = resolved;
  return resolved;
}

/**
 * The script that runs before anything is drawn.
 *
 * Inlined into the document head so the theme is settled before the first
 * paint. Without it every load of a light-themed app flashes dark for a frame,
 * which is worse than not offering the choice at all.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_KEY)};var c=localStorage.getItem(k)||'system';
var r=c==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):c;
document.documentElement.setAttribute('data-theme',r);
document.documentElement.style.colorScheme=r;
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
