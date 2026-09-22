# Panelmate

Design matching Eurorack faceplates, so a rack of mismatched hardware ends up
looking like one instrument.

Point it at a module — a photo, or its name on ModularGrid — and it finds the
jack, pot, LED and slider cutouts for you, and names the panel after it. Restyle the panel, arrange your
panels into a rack, and export STL or 3MF to print.

![No screenshot yet — run `npm run dev` and open http://localhost:3000](#)

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
npm run verify       # geometry, detection, rack, storage and file self-checks
npm run verify:ui    # browser checks against a running dev server
npm run build        # production build
```

Nothing needs configuring, and there is no server or database: everything runs
in the browser. ModularGrid lookup is the one optional extra, and it is off
unless you ask for it — `.env.local`:

```bash
MODULARGRID_ENABLED=1
```

## Publishing it

The app is almost entirely client-side, but not quite: three routes have to run
on a server.

| route | why it cannot be in the browser |
| --- | --- |
| `/api/font` | Google Fonts serves woff2 to browsers, which opentype.js cannot parse; asking for TrueType needs a User-Agent a page cannot set |
| `/api/proxy-image` | reading pixels from a cross-origin image taints the canvas |
| `/api/modulargrid/module` | cross-origin, and ModularGrid has no API |

So it wants a host that runs Next.js. **Vercel's Hobby plan** is the
straightforward answer: it is Next's own host, free, needs no card, and takes no
configuration — the defaults are already right.

```bash
npx vercel          # first run walks through login and setup
npx vercel --prod   # subsequent deploys
```

Or connect the repository on vercel.com and every push deploys itself.

Hobby is free for personal, non-commercial use, which this is. Nothing needs
setting up: with no environment variables at all the app works, minus
ModularGrid lookup, which stays off until `MODULARGRID_ENABLED=1` is set in the
project's settings.

**Before turning ModularGrid on in public**, note that rate limiting is held in
memory, and a serverless host starts fresh instances constantly, so in practice
it barely limits anything. Module pages are cached for a week, which does most
of the work of keeping the load down, but if the URL is going to be shared
around it is kinder to leave the lookup switched off and paste image URLs
instead.

Netlify and Cloudflare Pages also host Next, with a little more setup —
Cloudflare needs `@opennextjs/cloudflare`. A purely static host such as GitHub
Pages cannot run the three routes, which would cost ModularGrid lookup and
loading images by URL; uploading and pasting would still work.

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

### Ignoring the printing

Panels are covered in lettering, and a letter is small, dark and round enough
that no amount of shape analysis separates an "o" from a 3 mm LED by looking at
it alone.

What does separate them is that they cannot both exist. Holes go through the
panel, so two of them cannot intersect — there would be nothing left in
between. Letters in a word sit about two thirds of their own width apart, so
read as holes they overlap heavily, which is impossible. Anything that would
run into its neighbour is discarded, and the count is reported rather than
hidden.

A second giveaway survives even when several letters get folded into one
reading: a real hole is found in the same place at every exposure, so its
readings are concentric, while a word's are smeared along its length. On a real
30 HP panel the two together take the spurious cutouts from 24 down to a
handful.

### Branding

The look comes from the kit in `panelmate-brand/`, and that folder is the
source: the app holds copies rather than variations of it.

Four colours are named — Rack Ink, Brushed Alu, Signal Lime, Patch Coral — and
an interface needs more tones than four, so they are the fixed points of a
scale running from the page background to the brightest text. Both ends are the
kit's own values rather than approximations, which matters for more than
fidelity: the kit's SVGs carry their knockouts as background-coloured shapes
rather than as true holes, so the mark only sits cleanly on a page whose
background is exactly Rack Ink, or exactly Brushed Alu.

Signal Lime is the one colour that cannot be used as given in both themes. At
full strength it reads 1.5:1 against Brushed Alu, which is invisible, so the
light theme carries the same hue solved for 4.7:1 instead. Patch Coral does the
destructive-action work in the interface; the kit assigns it to output jacks,
which is panel artwork rather than chrome, so the two uses do not meet.

Type follows the kit's division. Bricolage Grotesque sets the wordmark — at
optical size 96, which is why the variable cut is the one loaded — along with
names, buttons and prose. IBM Plex Mono, uppercase and tracked, sets panel
labels, specs and interface metadata, and nothing longer: it is a label style,
and a sentence set in it is unreadable. Both are self-hosted through
`next/font`, so a page load asks nothing of Google.

The header lockup is live text rather than the kit's outlined wordmark — same
face, weight and tracking, a fifth of the bytes — placed in the kit's own
proportions: the wordmark's ink is 0.63 of the mark's height and stands 0.385
of it away, both measured off `lockup-dark.svg`. The mark itself is the kit's
simplified cut, meant for use below 64px; the full one adds a knurl, a jack and
HP ticks that close into grey at the 32px the header gives it.

`npm run verify` compares all of this against the kit: the mark's geometry, the
favicon byte for byte, every named colour's presence in the palette, and
whether each theme's accent actually carries against its own background.

### Light and dark

Follow the system, or pin it either way. The choice is applied by a small
script in the document head, before anything is drawn, because otherwise every
load of a light-themed page flashes dark for a frame. The 3D preview is told
the theme directly, since it builds its colours in JavaScript and cannot
inherit them through CSS.

Cutouts are the one thing that ignores the theme, because a hole has to
contrast with the *panel* it is cut through rather than with the interface
around it. A dark hole is used wherever it can be seen, since that is what a
hole really looks like; where it cannot — a black or dark green faceplate — the
hole is lightened by exactly as much as the contrast formula asks for. A fixed
pair of tones was legible on black but managed only 3.3:1 against dark green,
which is the sort of gap that stays invisible until somebody picks that colour.

### Editing

Cutouts, text, shapes and traced artwork are all draggable on the canvas.

| | |
| --- | --- |
| drag | move |
| drag a handle | resize, rotate, or round the corners |
| **Alt** + drag | duplicate — the copy comes with you, badged, while the original stays put |
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

Dragging shows alignment guides. Panels are built out of rows and columns, and
getting two things onto the same axis by eye is the fiddliest part of laying one
out — so while something is being dragged its centre is compared against
everything else, and when it comes close to sharing an axis it snaps on and a
line shows what it lined up with. The panel's own centre line counts too, drawn
in a different colour. Hold ⌘/Ctrl to ignore all of it.

Alignment is decided before the grid, because lining two things up is the more
specific intention; the grid only fills in where nothing lined up. A multiple
selection is snapped by the cutout you grabbed and the rest follow, so a group
keeps its internal spacing instead of each piece snapping somewhere different.

Selecting a single cutout gives it handles: resize from the edges or the
corner, rotate from the arm above it, and drag the small square inward to round
the corners. Resizing works about the centre, since where a cutout sits is
usually the part you placed carefully. Everything is measured in the cutout's
own frame, so the width handle on a cutout turned 30° widens it along its own
axis rather than the screen's. Shift snaps rotation to 15° steps.

### Two shapes, and standard sizes

A cutout is a circle or a rectangle with a corner radius. That is all that is
needed: a radius of zero gives sharp corners, and a radius of half the shorter
side gives the stadium that a fader slot or mounting slot actually is. Carrying
a separate slot shape only meant three ways to describe the same geometry.

The palette offers shapes rather than components — circle, rectangle, rounded
rectangle, slot — because placing a cutout is placing a shape. Which part
eventually goes through it is a property of that shape, set afterwards from
**standard size** on the selected cutout, not a decision you should have to make
before you can draw anything. Cutouts placed by hand are listed by what they
are ("Circle 6 mm", "Slot 30 × 4 mm") until you name one.

Sizes come from the hardware. A 3.5 mm jack is a Thonkiconn-style PJ301M with a
6 mm bushing; a panel pot is an Alpha 9 mm with a 7 mm bushing; sub-miniature
toggles are M6. Detection measures a hole to work out *what* it is and then
throws the measurement away, because a photograph will never measure twenty
jacks at exactly the same size, and a panel where every jack differs by a tenth
of a millimetre is wrong — they take identical hardware, so they take identical
holes.

Holes of the same size are also decided together. Classified one at a time, a
row of identical jacks does not come out identical: measurement noise pushes
some across a size boundary and they arrive as buttons or LEDs. So circular
holes are grouped by measured diameter and each group is settled once, by the
total confidence behind each candidate, and anything reassigned to match its
neighbours is marked so a genuine odd one out is still easy to find.

Printer allowance is separate and adjustable, rather than baked into every
size. Cutouts are drawn at the manufacturer's figure and opened up by **hole
allowance** (0.2 mm by default) when the model is built, so it can be dialled
in for a printer without editing a single panel.

Circles are drawn as polygons that *enclose* the true circle rather than fit
inside it. The obvious construction makes a 6 mm hole come out at about
5.98 mm, and for a hole that is the wrong direction to be wrong in: a bushing
that will not fit ruins the panel, while a hair of clearance disappears behind
the nut.

### Saving, export and import

Whatever is on screen is written down continuously and comes back after a
refresh, a crash or a closed tab — the panel, its name, the source photo, the
crop, the detection settings, even which view you were in. Losing an
afternoon's work is not a fair price for never having pressed Save. The app
says so when it restores, and offers to start fresh instead.

That is separate from the library. A panel is in the library because you put it
there; the session is just where you were.

Panels and racks are kept in this browser, in IndexedDB. Not localStorage: that
caps out around 5 MB for the whole origin, and one panel with traced artwork
carries thousands of points, so a modest library reaches the limit and saves
start failing. Anything stored by an earlier version moves across automatically
the first time you open the app.

Browser storage is still browser storage, so **export is how work survives**:

- **Export all** — the whole library plus the rack, as one file.
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
marked. The common case widths are offered as presets, but any width can be
typed — home-built cases and rack ears come in whatever size they come in. The
rack is drawn as wide as the window allows rather than at a fixed scale, and
the zoom multiplies that. Panels in the rack are drawn from the same geometry as the editor, so
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
- cutouts hold their standard sizes: every jack the same, circles never cut
  under their nominal diameter, and designs written before the shapes were
  collapsed still open
- alignment snaps to a shared axis however far apart two cutouts are, draws a
  guide reaching both, takes the nearer of two candidates, and leaves a miss
  alone
- a cutout stays visible on every panel colour the app offers, at 5:1 or
  better, in either theme
- module search ranks the module above replacement panels for it, collapses
  the duplicate entries ModularGrid keeps, and offers every variant of a name
  like "disting" rather than guessing which was meant
- editor actions hold up: duplicating returns the new ids and copies land
  exactly on the original (which is what Alt-drag relies on), dragging artwork
  translates its outlines, and designs round-trip through storage
- files round-trip: a rack export carries exactly the panels it uses, damaged
  entries are skipped rather than failing the file, re-importing a backup does
  not duplicate it, an older copy cannot overwrite a newer one, and importing
  as copies rewires the rack to the copies
- storage works and the move off localStorage carries a library across once,
  clears the old keys, and does nothing on a second run
- a reload restores the panel, its name, the source picture's crop and scale,
  and the view you were in, and writing only begins once the reload has
  finished so the restored work cannot be overwritten by the empty panel the
  app starts on

It caught every interesting bug in this codebase, including a crash on the
default font and a triangulation that silently dropped four of eleven rings
while still producing a watertight mesh.

`npm run verify:ui` covers what the headless suite cannot see, by driving a
real browser against a running dev server: whether a handler is wired to the
right element, whether state survives a sequence of steps, whether a request
that works from a terminal also works from a page. It uses an
already-installed Chrome rather than downloading one, and skips cleanly if
there is none or nothing is running.

## ModularGrid

Type a module name — "Maths", "Disting", "Plaits" — and pick from what comes
back. Pasting a link works too, in the ModularGrid field or the plain URL one,
since pasting a module link there is an obvious thing to do; without that the
link goes to the image proxy, which quite correctly refuses a page of HTML.

Searching is done here rather than through a search engine. Every engine
refuses this from a server: Google answers a plain request with a "turn on
JavaScript" page, DuckDuckGo returns its home page, Bing and Mojeek block
outright — and that is from a home connection, which a deployment does not
have. The paid APIs all want a key, which is a poor trade for looking up a
module name.

ModularGrid publishes a sitemap, which is a list of every page they have and
exists to be read by tools. Their addresses are simply the maker and the model
hyphenated, so that list is also an index of every module by name. It is
fetched twice a day, twelve hours apart, and held here in between, so typing
costs their servers nothing and a module added this morning is findable this
evening. Two fetches of a five megabyte file, against the hundreds of page
requests the same searching would otherwise cost them.

Replacement faceplates are listed on ModularGrid under the same names as the
modules they replace, so they are ranked below them — "bluebox" finds the 1010
Music module first, with the panels after it.

The width comes from the module's page rather than from the picture. A render
is often padded by a pixel or two, which is enough to read a 30 HP module as
29, and being one pitch out misplaces every hole on the panel. Off unless `MODULARGRID_ENABLED=1`,
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
panelmate-brand/      the brand kit: tokens, logo files, design artboards
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
