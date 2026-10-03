'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { panelHeightMm, panelWidthMm } from '@/lib/eurorack';
import { uid, type ArtElement, type ReliefMode, type ShapeElement, type TextElement } from '@/lib/types';
import { newElementAt, useStore } from '@/lib/store';
import { traceArtwork } from '@/lib/model/trace';
import { FONT_FAMILIES, nearestWeight, weightsFor } from '@/lib/fonts';
import { Button, ColorInput, Field, NumberInput, ROTATION_DETENTS, Section, Select, Slider, shared } from './ui';
import { IconPicker } from './IconPicker';
import { iconLabel } from '@/lib/icons';
import { combineSvgShapes, fitRings, isSvgFile, readSvg } from '@/lib/svgImport';

const RELIEF_OPTIONS: Array<{ value: ReliefMode; label: string }> = [
  { value: 'raised', label: 'Raised — sits on the surface' },
  { value: 'engraved', label: 'Engraved — cut into the surface' },
  { value: 'flush', label: 'Flush — level, in another colour' },
];

export function DecorTab() {
  const design = useStore((s) => s.design);
  const decor = design.decor;
  const addDecor = useStore((s) => s.addDecor);
  const addTextLabel = useStore((s) => s.addTextLabel);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const setView = useStore((s) => s.setView);
  const removeDecor = useStore((s) => s.removeDecor);
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);

  const W = panelWidthMm(design.hp);
  const H = panelHeightMm(design.format);

  const selected = decor.find((d) => selectedIds.includes(d.id));
  const selectedDecor = decor.filter((d) => selectedIds.includes(d.id));
  const textIds = decor.filter((d) => d.type === 'text').map((d) => d.id);

  /** Shift or Cmd adds to the selection or takes back out, as on the canvas. */
  const pick = (e: React.MouseEvent, id: string) => {
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) { select([id]); return; }
    select(selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id]);
  };

  return (
    <>
      <Section title="Add">
        <div className="grid grid-cols-2 gap-1">
          <Button onClick={addTextLabel}>Text label</Button>
          {/* Draws, like a cutout: drag from one end of the line to the other. */}
          <Button onClick={() => { setView('2d'); setTool(tool === 'line' ? null : 'line'); }}>
            {tool === 'line' ? 'Drawing a line…' : 'Line / shape'}
          </Button>
        </div>
        <IconPicker />
        <ArtworkTracer />
      </Section>

      <Section title={`Elements (${decor.length})`}>
        {decor.length === 0 ? (
          <p className="py-2 text-center text-[13.5px] leading-relaxed text-ink-400">
            Nothing yet. Text and shapes become real geometry — raised off the
            panel or cut into it — so they survive the export.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {decor.map((d) => (
              <li key={d.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => pick(e, d.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-[12.5px]
                    ${selectedIds.includes(d.id) ? 'bg-accent/15 text-accent' : 'text-ink-300 hover:bg-ink-800'}`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm border border-ink-600"
                    style={{ background: d.color }}
                  />
                  <span className="truncate">
                    {d.type === 'text' ? d.text || '(empty)'
                      : d.type === 'art' ? (d.icon ? `Icon: ${iconLabel(d.icon)}` : 'Traced artwork')
                      : d.shape}
                  </span>
                  <span className="ml-auto shrink-0 text-ink-400">
                    {d.mode === 'raised' ? '↑' : d.mode === 'flush' ? '≡' : '↓'}{d.reliefMm.toFixed(1)}
                  </span>
                </button>
                <Button variant="ghost" onClick={() => removeDecor(d.id)} title="Remove">×</Button>
              </li>
            ))}
          </ul>
        )}
        {textIds.length > 1 && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[12px] text-ink-400">Shift- or ⌘-click to pick several</span>
            <Button variant="ghost" onClick={() => select(textIds)}>Select all text</Button>
          </div>
        )}
      </Section>

      {selectedDecor.length > 1
        ? <BatchDecorEditor ids={selectedDecor.map((d) => d.id)} />
        : selected && <DecorEditor id={selected.id} />}
    </>
  );
}

function DecorEditor({ id }: { id: string }) {
  const el = useStore((s) => s.design.decor.find((d) => d.id === id));
  const update = useStore((s) => s.updateDecor);
  const design = useStore((s) => s.design);
  const ensureFont = useStore((s) => s.ensureFont);
  const customFonts = useStore((s) => s.customFonts);
  if (!el) return null;

  const W = panelWidthMm(design.hp);
  const H = panelHeightMm(design.format);

  return (
    <Section title="Selected element">
      {el.type === 'text' && (
        <>
          <Field label="Text">
            <input
              value={el.text}
              onChange={(e) => update(id, { text: e.target.value })}
              className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-[15px] outline-none
                         focus:border-accent"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Font">
              <Select
                value={el.fontFamily}
                onChange={(fontFamily) => {
                  // Onto the nearest weight the new family comes in.
                  const fontWeight = nearestWeight(fontFamily, el.fontWeight);
                  update(id, { fontFamily, fontWeight });
                  ensureFont(fontFamily, fontWeight);
                }}
                options={fontOptions(customFonts, el.type === 'text' ? el.fontFamily : '')}
              />
            </Field>
            <Field label="Weight">
              <Select
                value={String(nearestWeight(el.fontFamily, el.fontWeight))}
                onChange={(w) => { update(id, { fontWeight: Number(w) }); ensureFont(el.fontFamily, Number(w)); }}
                options={weightsFor(el.fontFamily).map((w) => ({ value: String(w), label: String(w) }))}
              />
            </Field>
          </div>

          <FontUpload
            onLoaded={(fontFamily) => {
              // Uploading from a label's own panel means "set this in it".
              update(id, { fontFamily });
              ensureFont(fontFamily, el.fontWeight);
            }}
          />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Cap height" hint="mm">
              <NumberInput value={el.sizeMm} onChange={(sizeMm) => update(id, { sizeMm })} min={0.8} max={60} step={0.1} />
            </Field>
            <Field label="Spacing" hint="mm">
              <NumberInput value={el.letterSpacing} onChange={(letterSpacing) => update(id, { letterSpacing })} min={-2} max={10} step={0.05} />
            </Field>
          </div>

          <Field label="Alignment">
            <Select
              value={el.align}
              onChange={(align) => update(id, { align })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </Field>
        </>
      )}

      {el.type === 'shape' && (
        <>
          <Field label="Shape">
            <Select
              value={el.shape}
              onChange={(shape) => update(id, { shape })}
              options={[
                { value: 'line', label: 'Line' },
                { value: 'rect', label: 'Rectangle' },
                { value: 'circle', label: 'Circle' },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Width" hint="mm">
              <NumberInput value={el.w} onChange={(w) => update(id, { w })} min={0.2} max={300} step={0.1} />
            </Field>
            <Field label="Height" hint="mm">
              <NumberInput value={el.h} onChange={(h) => update(id, { h })} min={0.2} max={300} step={0.1} />
            </Field>
          </div>
          {el.shape === 'rect' && (
            <Field label="Corner radius" hint="mm">
              <NumberInput value={el.radius} onChange={(radius) => update(id, { radius })} min={0} max={30} step={0.1} />
            </Field>
          )}
        </>
      )}

      {el.type === 'art' && (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            {el.icon
              ? <>Icon: {iconLabel(el.icon)}, from {el.icon.split(':')[0]} via Iconify.</>
              : <>Traced artwork: {el.rings.length} outline{el.rings.length === 1 ? '' : 's'}. Re-trace
                from the Add section to change the threshold.</>}
          </p>
          <Field label="Size" hint={`${Math.round(el.scale * 100)}%`}>
            <Slider min={5} max={400} step={1} value={Math.round(el.scale * 100)}
                    onChange={(pct) => update(id, { scale: pct / 100 })} />
          </Field>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="X" hint="mm">
          <NumberInput value={el.x} onChange={(x) => update(id, { x })} min={-50} max={W + 50} step={0.1} />
        </Field>
        <Field label="Y" hint="mm">
          <NumberInput value={el.y} onChange={(y) => update(id, { y })} min={-50} max={H + 50} step={0.1} />
        </Field>
      </div>

      <Field label="Rotation" hint={`${el.rotation.toFixed(0)}°`}>
        <Slider
          min={-180} max={180} step={1} value={el.rotation} onChange={(rotation) => update(id, { rotation })}
          detents={ROTATION_DETENTS.full} labelled={ROTATION_DETENTS.labelled}
        />
      </Field>

      <div className="border-t border-ink-800 pt-3">
        <Field label="Relief">
          <Select value={el.mode} onChange={(mode) => update(id, { mode })} options={RELIEF_OPTIONS} />
        </Field>
      </div>

      <Field
        label={el.mode === 'raised' ? 'Height above surface'
          : el.mode === 'flush' ? 'Depth of the colour' : 'Depth into surface'}
        hint={`${el.reliefMm.toFixed(2)} mm`}
      >
        <Slider
          min={0.1}
          max={el.mode === 'raised' ? 3 : Math.max(0.2, design.thicknessMm - 0.4)}
          step={0.05}
          value={el.reliefMm}
          onChange={(reliefMm) => update(id, { reliefMm })}
        />
      </Field>
      <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-400">
        {el.mode === 'raised'
          ? 'Two or three layer heights is plenty — 0.4 to 0.6 mm reads clearly and prints fast.'
          : el.mode === 'flush'
          ? 'The face stays level and only the colour changes. Exported as a shallow pocket with a '
            + 'matching piece to fill it, which is what a two-material printer needs; how deep it '
            + 'goes is how many layers print in the second colour.'
          : 'A recess, left open. For a level face in a second colour, use flush instead.'}
      </p>

      <Field label="Colour">
        <ColorInput value={el.color} onChange={(color) => update(id, { color })} />
      </Field>
    </Section>
  );
}

/**
 * Edit several elements at once.
 *
 * A field shows the value they share; where they differ it says so, shows
 * the first one's value, and setting it sets it on all of them. Text settings
 * apply to the labels in the selection and leave any shapes or artwork alone.
 * Each change is one step for undo, however many elements it touches.
 */
function BatchDecorEditor({ ids }: { ids: string[] }) {
  const decor = useStore((s) => s.design.decor);
  const updateMany = useStore((s) => s.updateDecorMany);
  const ensureFont = useStore((s) => s.ensureFont);
  const customFonts = useStore((s) => s.customFonts);
  const thicknessMm = useStore((s) => s.design.thicknessMm);

  const els = decor.filter((d) => ids.includes(d.id));
  const texts = els.filter((d): d is TextElement => d.type === 'text');
  const textIds = texts.map((t) => t.id);
  const others = els.length - texts.length;

  const family = shared(texts.map((t) => t.fontFamily));
  const weight = shared(texts.map((t) => t.fontWeight));
  const size = shared(texts.map((t) => t.sizeMm));
  const spacing = shared(texts.map((t) => t.letterSpacing));
  const align = shared(texts.map((t) => t.align));
  const mode = shared(els.map((d) => d.mode));
  const depth = shared(els.map((d) => d.reliefMm));
  const color = shared(els.map((d) => d.color.toLowerCase()));

  const mixedHint = (v: unknown, unit = '') => (v === undefined ? 'mixed' : unit);
  /** A select that can say "mixed" until something is picked. */
  const withMixed = <T extends string>(value: T | undefined, options: Array<{ value: T; label: string }>) =>
    value === undefined ? [{ value: '' as T, label: 'Mixed' }, ...options] : options;

  const setFamily = (fontFamily: string) => {
    if (!fontFamily) return;
    // Each label onto the nearest weight the new family comes in: grouped by
    // where they land, and close enough together to undo as one step.
    const byWeight = new Map<number, string[]>();
    for (const t of texts) {
      const w = nearestWeight(fontFamily, t.fontWeight);
      byWeight.set(w, [...(byWeight.get(w) ?? []), t.id]);
    }
    for (const [fontWeight, ids] of byWeight) {
      updateMany(ids, { fontFamily, fontWeight });
      ensureFont(fontFamily, fontWeight);
    }
  };
  // Only weights every selected family comes in.
  const families = [...new Set(texts.map((t) => t.fontFamily))];
  const commonWeights = weightsFor(families[0] ?? '').filter((w) => families.every((f) => weightsFor(f).includes(w)));
  const setWeight = (fontWeight: number) => {
    updateMany(textIds, { fontWeight });
    for (const f of new Set(texts.map((t) => t.fontFamily))) ensureFont(f, fontWeight);
  };

  const parts = [
    texts.length ? `${texts.length} label${texts.length === 1 ? '' : 's'}` : '',
    others ? `${others} other${others === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ');

  return (
    <Section title={`${els.length} selected`}>
      <p className="text-[12.5px] leading-relaxed text-ink-400" data-batch-editor="">
        {parts}. Changes here apply to all of them
        {texts.length && others ? '; text settings only to the labels' : ''}.
      </p>

      {texts.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Font" hint={mixedHint(family)}>
              <Select
                value={family ?? ''}
                onChange={setFamily}
                options={withMixed(family, fontOptions(customFonts, family ?? ''))}
              />
            </Field>
            <Field label="Weight" hint={mixedHint(weight)}>
              <Select
                value={weight === undefined ? '' : String(weight)}
                onChange={(w) => { if (w) setWeight(Number(w)); }}
                options={withMixed(weight === undefined ? undefined : String(weight),
                  commonWeights.map((w) => ({ value: String(w), label: String(w) })))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Cap height" hint={mixedHint(size, 'mm')}>
              <NumberInput
                value={size ?? texts[0].sizeMm}
                onChange={(sizeMm) => updateMany(textIds, { sizeMm })}
                min={0.8} max={60} step={0.1}
              />
            </Field>
            <Field label="Spacing" hint={mixedHint(spacing, 'mm')}>
              <NumberInput
                value={spacing ?? texts[0].letterSpacing}
                onChange={(letterSpacing) => updateMany(textIds, { letterSpacing })}
                min={-2} max={10} step={0.05}
              />
            </Field>
          </div>

          <Field label="Alignment" hint={mixedHint(align)}>
            <Select
              value={align ?? ''}
              onChange={(a) => { if (a) updateMany(textIds, { align: a as TextElement['align'] }); }}
              options={withMixed<string>(align, [
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ])}
            />
          </Field>
        </>
      )}

      <Field label="Relief" hint={mixedHint(mode)}>
        <Select
          value={mode ?? ''}
          onChange={(m) => { if (m) updateMany(ids, { mode: m as ReliefMode }); }}
          options={withMixed<string>(mode, RELIEF_OPTIONS)}
        />
      </Field>

      <Field
        label={mode === 'raised' ? 'Height above surface'
          : mode === 'flush' ? 'Depth of the colour' : mode === 'engraved' ? 'Depth into surface' : 'Height or depth'}
        hint={depth === undefined ? 'mixed' : `${depth.toFixed(2)} mm`}
      >
        <Slider
          // As for one element, except that a mix of raised and sunk takes
          // the tighter limit, since nothing may go through the panel.
          min={0.1}
          max={mode === 'raised' ? 3 : Math.max(0.2, thicknessMm - 0.4)}
          step={0.05}
          value={depth ?? els[0].reliefMm}
          onChange={(reliefMm) => updateMany(ids, { reliefMm })}
        />
      </Field>

      <Field label="Colour" hint={mixedHint(color)}>
        <ColorInput value={color ?? els[0].color} onChange={(c) => updateMany(ids, { color: c })} />
      </Field>
    </Section>
  );
}

/**
 * The built-in families, then the user's own.
 *
 * A label can name a family that is in neither — one set in an uploaded font
 * on another machine and arrived in a backup — and the list must still show
 * what it is set in rather than silently displaying the first entry.
 */
function fontOptions(custom: string[], current: string): Array<{ value: string; label: string }> {
  const builtIn = FONT_FAMILIES as readonly string[];
  const options = [
    ...builtIn.map((f) => ({ value: f, label: f })),
    ...custom.map((f) => ({ value: f, label: `${f} (uploaded)` })),
  ];
  if (current && !builtIn.includes(current) && !custom.includes(current)) {
    options.push({ value: current, label: `${current} (missing)` });
  }
  return options;
}

function FontUpload({ onLoaded }: { onLoaded: (family: string) => void }) {
  const addCustomFont = useStore((s) => s.addCustomFont);

  return (
    <Field label="Or use your own font">
      <input
        type="file"
        accept=".ttf,.otf,font/ttf,font/otf"
        onChange={async (e) => {
          const input = e.target;
          const f = input.files?.[0];
          input.value = '';
          if (!f) return;
          const family = await addCustomFont(f);
          if (family) onLoaded(family);
        }}
        className="w-full text-[12.5px] text-ink-400 file:mr-2 file:rounded file:border-0
                   file:bg-ink-700 file:px-2 file:py-1 file:text-[12.5px] file:text-ink-100"
      />
    </Field>
  );
}

/**
 * Turn a bitmap into printable relief.
 *
 * A picture cannot be printed as it is, so this traces it to outlines that
 * get extruded like any other decor. The threshold is exposed because
 * where the edge falls is a judgement call about the artwork, not something
 * that can be inferred.
 */
function ArtworkTracer() {
  const design = useStore((s) => s.design);
  const addDecor = useStore((s) => s.addDecor);
  const addTextLabel = useStore((s) => s.addTextLabel);
  const addShapeElement = useStore((s) => s.addShapeElement);
  const setError = useStore((s) => s.setError);
  const [threshold, setThreshold] = useState(128);
  const [invert, setInvert] = useState(false);
  const [detail, setDetail] = useState(0.6);
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<Box | null>(null);
  const [busy, setBusy] = useState(false);
  // An SVG is used for its own outlines unless asked to be traced like a picture.
  const svg = file !== null && isSvgFile(file);
  const [traceSvg, setTraceSvg] = useState(false);

  // Revoked when the file changes or the tracer goes away, or every pick
  // leaks a blob for the life of the page.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const rings = await traceArtwork(file, {
        threshold,
        invert,
        crop: crop ?? undefined,
        simplifyPx: detail,
        targetWidthMm: panelWidthMm(design.hp) * 0.8,
        panelWidthMm: panelWidthMm(design.hp),
        panelHeightMm: panelHeightMm(design.format),
      });
      if (!rings.length) {
        setError('Nothing traced — try moving the threshold or inverting.');
        return;
      }
      const pts = rings.flat();
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const el: ArtElement = {
        id: uid('a'),
        type: 'art',
        // Stored about its own centre, so scaling and turning it do not have
        // to rewrite thousands of traced points.
        rings: rings.map((ring) => ring.map((p) => ({ x: p.x - cx, y: p.y - cy }))),
        x: cx, y: cy, scale: 1, rotation: 0,
        // Flush by default, like a new label.
        color: '#f2f2f0', mode: 'flush', reliefMm: 0.6,
      };
      addDecor(el);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not trace that image');
    } finally {
      setBusy(false);
    }
  };

  const addOutlines = async () => {
    if (!file) return;
    setBusy(true);
    try {
      // Laid out at the preview's own size, so a crop drawn over the
      // preview lands on the same part of the drawing.
      const img = new Image();
      img.src = preview!;
      await img.decode();
      const size = { width: img.naturalWidth || 300, height: img.naturalHeight || 150 };
      const { shapes, skipped } = readSvg(await file.text(), size);
      const W = panelWidthMm(design.hp), H = panelHeightMm(design.format);
      const clip = crop
        ? { x: crop.x * size.width, y: crop.y * size.height, w: crop.w * size.width, h: crop.h * size.height }
        : undefined;
      const rings = fitRings(combineSvgShapes(shapes, clip), W * 0.8, H * 0.8);
      const left = [
        skipped.strokes ? `${skipped.strokes} stroked line${skipped.strokes === 1 ? '' : 's'}` : '',
        skipped.text ? `${skipped.text} piece${skipped.text === 1 ? '' : 's'} of live text` : '',
        skipped.other ? `${skipped.other} linked or embedded part${skipped.other === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(', ');
      const fix = 'convert strokes and text to outlines in your editor';
      if (!rings.length) {
        setError(crop
          ? 'Nothing filled inside that crop — draw the box over part of the drawing.'
          : left
          ? `Nothing filled to use in that SVG — it has ${left}. Try: ${fix}.`
          : 'Nothing filled to use in that SVG.');
        return;
      }
      const at = newElementAt({ x: W / 2, y: H / 2 });
      addDecor({
        id: uid('a'),
        type: 'art',
        rings,
        x: at.x, y: at.y, scale: 1, rotation: 0,
        // Flush by default, like a new label.
        color: '#f2f2f0', mode: 'flush', reliefMm: 0.6,
      });
      if (left) setError(`Added the filled shapes. Left out ${left}: ${fix}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that SVG');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-ink-800 pt-3">
      <Field label="Trace an image into relief">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCrop(null); setTraceSvg(false); }}
          className="w-full text-[12.5px] text-ink-400 file:mr-2 file:rounded file:border-0
                     file:bg-ink-700 file:px-2 file:py-1 file:text-[12.5px] file:text-ink-100"
        />
      </Field>

      {svg && preview && !traceSvg && (
        <>
          <CropPicker src={preview} crop={crop} onChange={setCrop} light />
          <Button variant="primary" onClick={() => void addOutlines()} disabled={busy} className="w-full">
            {busy ? 'Reading…' : 'Use its outlines'}
          </Button>
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            An SVG already is outlines, so its shapes are used exactly as
            drawn rather than traced; drag across it to use only part. White shapes cut away what is beneath
            them, as in most logos. Strokes and live text are left out until
            converted to outlines.{' '}
            <button type="button" onClick={() => setTraceSvg(true)} className="underline hover:text-ink-200">
              Trace it as a picture instead
            </button>
          </p>
        </>
      )}

      {file && preview && (!svg || traceSvg) && (
        <>
          <CropPicker src={preview} crop={crop} onChange={setCrop} />
          <Field label="Threshold" hint={String(threshold)}>
            <Slider min={8} max={248} step={1} value={threshold} onChange={setThreshold} />
          </Field>
          <Field label="Detail" hint={detail <= 0.3 ? 'fine' : detail >= 1.4 ? 'coarse' : 'medium'}>
            <Slider min={0.1} max={2.5} step={0.1} value={detail} onChange={setDetail} />
          </Field>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-300">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            Invert (trace the light areas instead)
          </label>
          <Button variant="primary" onClick={() => void run()} disabled={busy} className="w-full">
            {busy ? 'Tracing…' : 'Trace to relief'}
          </Button>
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Works best on flat, high-contrast art such as a logo. Photographs
            trace into thousands of tiny islands.
          </p>
        </>
      )}
    </div>
  );
}

/** A box over the picture, as fractions of its width and height. */
interface Box { x: number; y: number; w: number; h: number }

/**
 * Pick the part of a picture to trace.
 *
 * Drag across the preview to draw a box; drag again to draw another. Edge
 * handles would be the fuller interaction, but redrawing is a single gesture
 * and this is a step people pass through once per image rather than live in.
 *
 * Held as fractions, because the preview is a couple of hundred pixels wide
 * and the file behind it may be four thousand.
 */
function CropPicker({
  src, crop, onChange, light,
}: {
  src: string;
  crop: Box | null;
  onChange: (b: Box | null) => void;
  /** A panel-coloured backdrop, for drawings that are dark on nothing. */
  light?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const [aspect, setAspect] = useState(1.5);

  const place = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  };

  const onDown = (e: React.PointerEvent) => {
    const p = place(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    from.current = p;
    onChange(null);
  };

  const onMove = (e: React.PointerEvent) => {
    const a = from.current;
    const p = a && place(e);
    if (!a || !p) return;
    onChange({
      x: Math.min(a.x, p.x),
      y: Math.min(a.y, p.y),
      w: Math.abs(p.x - a.x),
      h: Math.abs(p.y - a.y),
    });
  };

  const onUp = () => {
    from.current = null;
    // A tap rather than a drag means the whole picture, not a sliver of it.
    if (crop && (crop.w < 0.02 || crop.h < 0.02)) onChange(null);
  };

  const pct = (v: number) => `${v * 100}%`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label text-[12px] text-ink-400">Crop</span>
        {crop && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[12.5px] text-ink-400 hover:text-ink-100"
          >
            Use the whole image
          </button>
        )}
      </div>
      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        // Exactly the picture's size, so the box is a fraction of the picture
        // and not of letterboxing around it.
        className={`relative mx-auto w-fit max-w-full select-none overflow-hidden rounded-md border border-ink-700
          ${light ? 'bg-[#e8e6df]' : 'bg-ink-950'}`}
        style={{ cursor: 'crosshair', touchAction: 'none' }}
        data-crop-picker=""
      >
        {/* As wide as there is room for, up to 12rem tall, in proportion,
            however small or large the picture is in its own pixels. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src} alt="" draggable={false}
          onLoad={(e) => {
            const im = e.currentTarget;
            if (im.naturalWidth && im.naturalHeight) setAspect(im.naturalWidth / im.naturalHeight);
          }}
          className="block h-auto max-w-full"
          style={{ width: `min(100%, ${12 * aspect}rem)` }}
        />
        {crop && (
          <>
            {/* The part that will not be traced, dimmed rather than hidden, so
                the box can be judged against what is around it. */}
            <div className="pointer-events-none absolute inset-0 bg-ink-950/60" />
            <div
              className="pointer-events-none absolute overflow-hidden"
              style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={{
                  width: pct(1 / Math.max(crop.w, 1e-6)),
                  height: pct(1 / Math.max(crop.h, 1e-6)),
                  left: pct(-crop.x / Math.max(crop.w, 1e-6)),
                  top: pct(-crop.y / Math.max(crop.h, 1e-6)),
                }}
              />
            </div>
            <div
              className="pointer-events-none absolute border border-accent"
              style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
            />
          </>
        )}
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-400">
        {crop
          ? 'Only the boxed part is traced. Drag again to draw a different box.'
          : 'Drag across the picture to trace only part of it.'}
      </p>
    </div>
  );
}
