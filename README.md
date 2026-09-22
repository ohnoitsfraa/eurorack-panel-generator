# Eurorack Panel Generator

Turn a photo of a Eurorack module into a customisable faceplate you can 3D
print. Upload or search for a module, let it find the jack, pot, LED and slider
cutouts, restyle the panel, and export STL or 3MF.

![No screenshot yet — run `npm run dev` and open http://localhost:3000](#)

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
npm run verify       # geometry, detection, rack, storage and file self-checks
npm run build        # production build
```

Nothing needs configuring, and there is no server or database: everything runs
in the browser. ModularGrid lookup is the one optional extra, and it is off
unless you ask for it — `.env.local`:

```bash
MODULARGRID_ENABLED=1
```

## How it works

### Scale comes free

Eurorack panels are dimensionally standardised: 1 HP is 5.08 mm, a 3U panel is
128.5 mm tall. So once you say "8 HP, 3U", millimetres-per-pixel falls straight
out of the cropped image. No calibration target, no coin next to the module.

That is what makes detection reliable. Instead of guessing from pixel ratios,
every candidate hole is measured in millimetres and matched against what the
part actually is: a 6.2 mm circle is a 3.5 mm jack, a 3.1 mm circle is an LED,
a 3 × 60 mm slot is a fader. Component size ranges overlap on purpose — a large
tact button and a small knob really are the same size on a panel — so
candidates are scored rather than matched on the first range that fits.

Because the crop sets the scale, trimming it to the true panel edges matters.
A 5% error in the crop is a 5% error in every measured diameter.

Tell it whether it is looking at a photograph or at panel artwork, because the
two differ more than you would expect. A photo shows the fitted hardware, so a
3.5 mm jack measures about 8 mm across its nut. A drawing shows the socket
opening instead, so the same jack measures about 4 mm. Getting this wrong turns
every jack into an LED. Loading from ModularGrid selects artwork for you.

Artwork has a second quirk: a knob is drawn as a dark outline around a light
face, so the dark pixels form a ring rather than a disc. Rings are detected
too — round, square bounding box, but only a fraction of it filled — which is
the only way those knobs get found at all.

### Finding the holes

Photographs defeat a single brightness threshold: a black jack nut and a dark
grey screened label sit either side of it depending on exposure. Detection
sweeps a ladder of thresholds instead and keeps the shapes that stay stable
across several of them, which is the idea behind MSER. Each blob is measured
with image moments, giving an orientation and the extent along that axis — a
diagonal fader has a useless axis-aligned bounding box but a perfectly clear
principal axis.

Detections you edit or place by hand are marked so that re-running detection
leaves them alone. Anything the detector is unsure of is outlined in red.

### Editing

Cutouts, text, shapes and traced artwork are all draggable on the canvas.

| | |
| --- | --- |
| drag | move |
| **Alt** + drag | duplicate and drag the copy |
| **⌘/Ctrl** + drag | ignore the grid for this move |
| **Shift** + click | add to or remove from the selection |
| **Shift** + click *(with a tool armed)* | place, and stay armed for the next one |
| arrows / **Shift** + arrows | nudge by the grid pitch / five steps |
| **⌘/Ctrl** + D | duplicate |
| **Delete** | remove |
| **Esc** | drop the tool and the selection |

Text is thin at panel sizes, so each element has an invisible hit area over its
bounding box — you do not have to land the pointer on a 0.4 mm letter stroke to
move a label.

### Saving, export and import

Panels and racks are kept in this browser, in IndexedDB. Not localStorage: that
caps out around 5 MB for the whole origin, and one panel with traced artwork
carries thousands of points, so a modest library reaches the limit and saves
start failing. Anything stored by an earlier version moves across automatically
the first time you open the app.

Browser storage is still browser storage, so **export is how work survives**:

- **Export everything** — the whole library plus the rack, as one file.
- **Export rack** — a rack together with the panels it places, so it opens
  complete somewhere else. Only the panels actually used; exporting a rack
  should not hand over the rest of your library.
- **Export panel** — the ↓ on any panel in the library.

Files are plain JSON with a version stamp. They can be read, diffed, kept in
version control, or hand-edited, and a file written today will still open after
the app has moved on.

Importing merges rather than replaces. Panels match by id and the newer edit
wins, so re-importing a backup restores instead of duplicating, and a file that
leaves a panel out is not a request to delete it. **Import as copies** brings a
file in under fresh ids alongside what you already have, which is what you want
when someone sends you a rack and you would rather not touch your own panels.

Reference photos are not saved with a design. A data URL runs to megabytes and
the photo is a guide for designing rather than part of the model.

## Racks

Save panels to a library and arrange them into rows, the way ModularGrid does.
Rows take a width in HP and a format, panels snap to whole HP because that is
where the rails are drilled, and anything overlapping or hanging off the end is
marked. Panels in the rack are drawn from the same geometry as the editor, so
the rack shows what will print.

The whole rack exports in one go, with every panel as a separate object
positioned as it sits in the rack. That is the right arrangement for checking
the front of a case; it is not a print layout, since an 84 HP row is 427 mm
wide. Print panels one at a time, or let your slicer rearrange the objects.

The library lives in this browser's localStorage. Reference photos are not
saved with a design — a data URL runs to megabytes and would fill the quota
after a few panels, and the photo is a guide for designing rather than part of
the model.

### From design to solid

Cutouts, text and artwork all become real geometry. Panel outline and holes are
resolved into a material profile, decor is extruded as raised relief or sunk as
an engraving, and the result is triangulated into a closed solid.

Two things make that harder than it sounds, and both are handled rather than
guarded against:

**Font outlines are not simple polygons.** Fonts are filled with a
nonzero-winding rule, so a designer can let the two strokes of a "V" overrun
each other at the apex. Handed to a triangulator directly, Inter's "V" covers
82% more area than the glyph occupies. Every outline goes through a polygon
boolean first, which resolves the self-overlap and leaves counters intact.

**Engraving needs no CSG.** Containment depth sorts rings into solid and hole,
recursively, so a letter's counter comes back as an island at full height
inside its pocket. The pocket supplies its own floor and inward-facing walls.
Engravings are clipped to stay 0.25 mm clear of any cutout or the panel edge,
which avoids a fragile knife edge on the print and keeps two holes from ever
sharing a boundary.

### Export

**3MF** is the one to use. It keeps millimetre units, separate objects and
colours, so a two-material printer picks up a black panel with white legends as
two objects already assigned to two materials.

**STL** carries no colour and no object structure. Single merged STL and
one-STL-per-colour (zipped) are both offered.

Print face down on a smooth plate: the first layer becomes the visible front,
so it comes out flat and even with no supports.

## Verification

`npm run verify` is a headless self-check, and it is the reason to trust the
export. A mesh that looks right in the 3D preview can still slice into a ruined
print, so the script checks the properties a preview cannot show:

- every exported mesh is watertight, with each directed edge matched by its
  reverse, and encloses positive volume — for single panels and for a built
  rack
- invalid designs are reported — overlapping cutouts, engravings that run off
  the panel
- detection recovers known cutouts from a synthetic panel, with position,
  type and measured size compared against ground truth
- real glyph outlines survive nesting, both relief modes and export
- rack packing puts panels in the leftmost gap, flags overlaps and overhangs,
  and stacks rows to the right height
- editor actions hold up: duplicating returns the new ids and copies land
  exactly on the original (which is what Alt-drag relies on), dragging artwork
  translates its outlines, and designs round-trip through storage
- files round-trip: a rack export carries exactly the panels it uses, damaged
  entries are skipped rather than failing the file, re-importing a backup does
  not duplicate it, an older copy cannot overwrite a newer one, and importing
  as copies rewires the rack to the copies
- storage works and the move off localStorage carries a library across once,
  clears the old keys, and does nothing on a second run

It caught every interesting bug in this codebase, including a crash on the
default font and a triangulation that silently dropped four of eleven rings
while still producing a watertight mesh.

## ModularGrid

Paste a module link — `modulargrid.net/e/make-noise-maths`, or just the slug —
and the panel image, name and HP all arrive. Off unless `MODULARGRID_ENABLED=1`,
cached for a week, and rate limited. Uploading a photo, pasting an image URL and
pasting from the clipboard all work without it.

There is deliberately no search box. ModularGrid publishes no API, and their
search filters results against a session that only a real browser establishes:
requesting the listing without one returns all fifteen thousand modules in
alphabetical order, which a scraper cannot tell from a result set. Rather than
a search box that quietly returns the wrong modules, typing a name offers a
link to ModularGrid's own search with the term filled in — search there, paste
the link back. One request to their servers instead of many, and nothing to
break when they change their markup.

Detection is noticeably harder on a ModularGrid render than on a photograph:
the image is panel artwork, and printed graphics are shaped like holes. Expect
to delete some false positives. On Make Noise Maths it finds about 31 jacks
against a true 20, and 9 knobs against a true 8 — a good starting point to
tidy up, not a finished layout.

If you would rather not ship it, delete `src/lib/modulargrid.ts` and
`src/app/api/modulargrid/`, and drop the third tab in `SourcePanel.tsx`.

## Layout

```
src/
  lib/
    eurorack.ts       HP/U constants, mounting slots, component catalogue
    types.ts          PanelDesign and friends
    cv/               detection: threshold sweep, blob moments, classification
    geom/             polygons, boolean ops, contour tracing, simplification
    model/            text outlines, mesh building, design -> solid
    export/           STL, 3MF, downloads
    storage.ts        designs and racks in IndexedDB
    backup.ts         the export file format, and import merging
    rack.ts           rack rows, HP packing, collisions
  components/         editor, 3D preview, rack, inspector
  app/api/            font resolution, image proxy, ModularGrid
scripts/verify.mts    self-checks
```

## Notes

- `react` and `react-dom` are pinned exactly, not by range. `@react-three/fiber`
  requires `react >=19 <19.3`, and a caret range drifts onto 19.3 where the
  dependency tree no longer resolves — `npm ci` then fails outright, which
  breaks any clean install including a deploy. Check `npm ci` from scratch
  before changing them, since `npm install --legacy-peer-deps` will happily
  paper over it.

- The font route exists because Google Fonts serves woff2 to browsers, which
  opentype.js cannot parse, and a browser cannot change its own User-Agent.
  Requesting server-side with our own identifier returns TrueType. You can also
  upload your own `.ttf`/`.otf`.
- The image proxy exists because reading pixels from a cross-origin image taints
  the canvas. It refuses non-public addresses so it cannot be used to probe a
  private network.
- `typescript` is pinned to 5.x. Next 15 loads `tsconfig.json` through the
  TypeScript 5 API and silently ignores it under TypeScript 7, which shows up
  as every `@/` import failing to resolve.
- Two `npm audit` findings remain, both in the copy of `postcss` bundled inside
  `next` itself. Clearing them needs `--force` and a Next downgrade.
