# Panelmate brand kit

Drop this folder into your repo (e.g. `brand/` or `public/brand/`) and point Claude Code at this README.

## Logo files (`svg/`)
All text is converted to outlines, so no font is needed to render the logos.

| File | Use |
|---|---|
| `lockup-{dark,light}.svg` | Mark + wordmark, e.g. in the app header |
| `mark-{dark,light}.svg` | Full-detail mark, 64 px and up |
| `mark-*-small.svg` | Simplified mark for under 64 px (no knurl, jack or HP ticks) |
| `wordmark-*.svg` | Wordmark only, transparent background |
| `*-mono-ink` / `*-mono-white` | One-colour versions for silkscreen, laser engraving and PCB artwork |
| `app-icon.svg` | 512 px rounded-square icon |
| `favicon.svg` | 32 px favicon: `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` |

The mark uses knockouts in the background colour, so `mark-*` and `lockup-*` include a background rect. Use each file on its matching background only.

## Rules
- Mark = a 3U panel stem + a graduated knob bowl, which together form a "P". Don't recolour individual parts.
- Clear space = one knob radius (about 21% of the mark's height) on every side.
- Wordmark: lowercase, Bricolage Grotesque 700, opsz 96, letter-spacing -0.045em.
- UI and panel labels: IBM Plex Mono, uppercase, letter-spacing 0.1–0.14em.
- Signal Lime marks active or accent elements; Patch Coral marks output jacks and signal-out.

## Tokens
`tokens.css` (CSS variables `--pm-*`) and `tokens.json` (colours, fonts, Eurorack constants: 1 HP = 5.08 mm, 3U = 128.5 mm).

## Design source
`design-source/*.dc.html` are the original canvas artboards (HTML + inline SVG). Use them as a reference, especially `InContext.dc.html` for how the generated panels are styled.
    