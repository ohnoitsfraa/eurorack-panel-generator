'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { maxEngraveDepthMm, panelHeightMm, panelWidthMm } from '@/lib/eurorack';
import { uid, type ArtElement, type ArtSource, type Pt, type ReliefMode, type ShapeElement, type TextElement } from '@/lib/types';
import { newElementAt, useStore } from '@/lib/store';
import { traceArtwork } from '@/lib/model/trace';
import { FONT_FAMILIES, nearestWeight, weightsFor } from '@/lib/fonts';
import { Button, ColorInput, Field, NumberInput, ROTATION_DETENTS, Section, Select, Slider, shared } from './ui';
import { IconPicker } from './IconPicker';
import { iconLabel } from '@/lib/icons';
import { combineSvgShapes, isSvgFile, readSvg } from '@/lib/svgImport';
import { bbox } from '@/lib/geom/poly';
import { loadImage, putImage } from '@/lib/storage';
import { pickInList } from '@/lib/listSelect';

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

  /** Cmd adds or takes out one; Shift takes the whole run from the last one picked. */
  const listAnchor = useRef<string | null>(null);
  const pick = (e: React.MouseEvent, id: string) => {
    const r = pickInList(decor.map((d) => d.id), selectedIds, listAnchor.current, id,
      { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
    listAnchor.current = r.anchor;
    select(r.selection);
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
              : <>Traced artwork: {el.rings.length} outline{el.rings.length === 1 ? '' : 's'}.
                {!el.source && ' Made before pictures were kept, so to crop it, trace the picture again from the Add section.'}</>}
          </p>
          {!el.icon && el.source && <ArtRedo key={el.id} el={el} />}
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
          max={el.mode === 'raised' ? 3 : Math.max(0.1, maxEngraveDepthMm(design.thicknessMm))}
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
          max={mode === 'raised' ? 3 : Math.max(0.1, maxEngraveDepthMm(thicknessMm))}
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

  const add = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const settings: SourceSettings = {
        kind: svg && !traceSvg ? 'svg' : 'trace', crop: crop ?? undefined, threshold, invert, detail,
      };
      const out = await outlinesOf(file, settings);
      if ('error' in out) { setError(out.error); return; }
      const W = panelWidthMm(design.hp), H = panelHeightMm(design.format);
      const b = bbox(out.rings);
      const w = Math.max(1e-9, b.x1 - b.x0), h = Math.max(1e-9, b.y1 - b.y0);
      // A trace across most of the panel's width; an SVG fitted inside it.
      const mmPerPx = settings.kind === 'svg' ? Math.min((W * 0.8) / w, (H * 0.8) / h) : (W * 0.8) / w;
      const { rings, at } = centred(out.rings, mmPerPx);
      const pos = settings.kind === 'svg' ? newElementAt({ x: W / 2, y: H / 2 }) : { x: W / 2, y: H / 2 };
      // Without the picture kept there is nothing to crop again later, but
      // the artwork itself is still worth having.
      const imageId = await putImage(file).catch(() => null);
      addDecor({
        id: uid('a'),
        type: 'art',
        rings,
        x: pos.x, y: pos.y, scale: 1, rotation: 0,
        // Raised by default, like a new label.
        color: '#f2f2f0', mode: 'raised', reliefMm: 0.6,
        source: imageId ? { ...settings, imageId, at, mmPerPx } : undefined,
      });
      if (out.note) setError(out.note);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use that image');
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
          <Button variant="primary" onClick={() => void add()} disabled={busy} className="w-full">
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
          <TraceControls
            threshold={threshold} detail={detail} invert={invert}
            onThreshold={setThreshold} onDetail={setDetail} onInvert={setInvert}
          />
          <Button variant="primary" onClick={() => void add()} disabled={busy} className="w-full">
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

function TraceControls({
  threshold, detail, invert, onThreshold, onDetail, onInvert,
}: {
  threshold: number; detail: number; invert: boolean;
  onThreshold: (v: number) => void; onDetail: (v: number) => void; onInvert: (v: boolean) => void;
}) {
  return (
    <>
      <Field label="Threshold" hint={String(threshold)}>
        <Slider min={8} max={248} step={1} value={threshold} onChange={onThreshold} />
      </Field>
      <Field label="Detail" hint={detail <= 0.3 ? 'fine' : detail >= 1.4 ? 'coarse' : 'medium'}>
        <Slider min={0.1} max={2.5} step={0.1} value={detail} onChange={onDetail} />
      </Field>
      <label className="flex items-center gap-2 text-[12.5px] text-ink-300">
        <input type="checkbox" checked={invert} onChange={(e) => onInvert(e.target.checked)} />
        Invert (trace the light areas instead)
      </label>
    </>
  );
}

/** How a picture is turned into outlines, short of where they end up. */
type SourceSettings = Omit<ArtSource, 'imageId' | 'at' | 'mmPerPx'>;

/**
 * A picture's outlines, in its own pixels.
 *
 * The same grid whatever the crop, so a second pass over the picture can be
 * laid exactly over the first. `note` is something worth telling the user
 * even though outlines were found.
 */
async function outlinesOf(file: Blob, s: SourceSettings): Promise<{ rings: Pt[][]; note?: string } | { error: string }> {
  if (s.kind === 'trace') {
    const rings = await traceArtwork(file, {
      threshold: s.threshold, invert: s.invert, crop: s.crop, simplifyPx: s.detail,
    });
    return rings.length ? { rings } : { error: 'Nothing traced — try moving the threshold or inverting.' };
  }
  // Laid out at the picture's own size, which is the size the crop preview
  // shows it at, so a box drawn over the preview lands on the same part.
  const url = URL.createObjectURL(file);
  let size: { width: number; height: number };
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    size = { width: img.naturalWidth || 300, height: img.naturalHeight || 150 };
  } finally {
    URL.revokeObjectURL(url);
  }
  const { shapes, skipped } = readSvg(await file.text(), size);
  const clip = s.crop
    ? { x: s.crop.x * size.width, y: s.crop.y * size.height, w: s.crop.w * size.width, h: s.crop.h * size.height }
    : undefined;
  const rings = combineSvgShapes(shapes, clip);
  const left = [
    skipped.strokes ? `${skipped.strokes} stroked line${skipped.strokes === 1 ? '' : 's'}` : '',
    skipped.text ? `${skipped.text} piece${skipped.text === 1 ? '' : 's'} of live text` : '',
    skipped.other ? `${skipped.other} linked or embedded part${skipped.other === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ');
  const fix = 'convert strokes and text to outlines in your editor';
  if (!rings.length) {
    return {
      error: s.crop
        ? 'Nothing filled inside that crop — draw the box over part of the drawing.'
        : left
        ? `Nothing filled to use in that SVG — it has ${left}. Try: ${fix}.`
        : 'Nothing filled to use in that SVG.',
    };
  }
  return { rings, note: left ? `Used the filled shapes. Left out ${left}: ${fix}.` : undefined };
}

/**
 * Outlines in picture pixels as an element's own rings: in millimetres and
 * centred on their middle, which is `at` in the picture.
 */
function centred(px: Pt[][], mmPerPx: number): { rings: Pt[][]; at: Pt } {
  const b = bbox(px);
  const at = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  return { rings: px.map((r) => r.map((p) => ({ x: (p.x - at.x) * mmPerPx, y: (p.y - at.y) * mmPerPx }))), at };
}

/**
 * Crop or trace a placed artwork again, from the picture it was made from.
 *
 * What stays in the box stays where it is on the panel and as large, however
 * the artwork has since been moved, scaled or turned, so redoing a crop reads
 * as trimming the artwork rather than as replacing it with a new one.
 */
function ArtRedo({ el }: { el: ArtElement }) {
  const update = useStore((s) => s.updateDecor);
  const setError = useStore((s) => s.setError);
  const source = el.source!;
  const [file, setFile] = useState<Blob | null | 'missing'>(null);
  const [open, setOpen] = useState(false);
  const [crop, setCrop] = useState<Box | null>(source.crop ?? null);
  const [threshold, setThreshold] = useState(source.threshold);
  const [invert, setInvert] = useState(source.invert);
  const [detail, setDetail] = useState(source.detail);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || file) return;
    let live = true;
    void loadImage(source.imageId).then((b) => { if (live) setFile(b ?? 'missing'); });
    return () => { live = false; };
  }, [open, file, source.imageId]);

  const preview = useMemo(() => (file instanceof Blob ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const start = () => {
    // From what the artwork is now, not from an earlier attempt left unapplied.
    setCrop(source.crop ?? null);
    setThreshold(source.threshold);
    setInvert(source.invert);
    setDetail(source.detail);
    setOpen(true);
  };

  const apply = async () => {
    if (!(file instanceof Blob)) return;
    setBusy(true);
    try {
      const settings: SourceSettings = { kind: source.kind, crop: crop ?? undefined, threshold, invert, detail };
      const out = await outlinesOf(file, settings);
      if ('error' in out) { setError(out.error); return; }
      const { rings, at } = centred(out.rings, source.mmPerPx);
      // The new middle is somewhere else in the picture; the element moves by
      // that much, as placed, so the outlines it keeps do not move at all.
      const a = (el.rotation * Math.PI) / 180;
      const dx = (at.x - source.at.x) * source.mmPerPx * el.scale;
      const dy = (at.y - source.at.y) * source.mmPerPx * el.scale;
      update(el.id, {
        rings,
        x: el.x + dx * Math.cos(a) - dy * Math.sin(a),
        y: el.y + dx * Math.sin(a) + dy * Math.cos(a),
        source: { ...source, ...settings, at },
      });
      if (out.note) setError(out.note);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use that image');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button onClick={start} className="w-full">
        {source.kind === 'svg' ? 'Redo the crop' : 'Redo the crop or trace'}
      </Button>
    );
  }
  if (file === 'missing') {
    return (
      <p className="text-[12.5px] leading-relaxed text-ink-400">
        The picture this was made from is not on this device — pictures stay
        where they were traced and do not travel in backups. Trace it again
        from the Add section to crop it.{' '}
        <button type="button" onClick={() => setOpen(false)} className="underline hover:text-ink-200">OK</button>
      </p>
    );
  }
  if (!preview) return <p className="text-[12.5px] text-ink-400">Loading the picture…</p>;

  return (
    <div className="space-y-2 rounded-md border border-ink-700 p-2" data-art-redo="">
      <CropPicker src={preview} crop={crop} onChange={setCrop} light={source.kind === 'svg'} />
      {source.kind === 'trace' && (
        <TraceControls
          threshold={threshold} detail={detail} invert={invert}
          onThreshold={setThreshold} onDetail={setDetail} onInvert={setInvert}
        />
      )}
      <div className="grid grid-cols-2 gap-1">
        <Button variant="primary" onClick={() => void apply()} disabled={busy}>
          {busy ? 'Working…' : 'Apply'}
        </Button>
        <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

/** A box over the picture, as fractions of its width and height. */
interface Box { x: number; y: number; w: number; h: number }

/**
 * Pick the part of a picture to trace.
 *
 * Drag across the preview to draw a box, then drag its edges, its corners or
 * the box itself to adjust it. A drag can start in the margin around the
 * picture and snaps to the border when it comes close, because art that runs
 * right to the edge is the common case and a pixel short of the edge would
 * shave a sliver off it.
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
  const [big, setBig] = useState(false);

  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);

  const hint = crop
    ? 'Only the boxed part is traced. Drag its edges or the box to adjust it, or drag outside it for a new one.'
    : 'Drag across the picture to trace only part of it. Start outside it to take it right to the edge.';

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label text-[12px] text-ink-400">Crop</span>
        <div className="flex gap-3">
          {crop && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[12.5px] text-ink-400 hover:text-ink-100"
            >
              Use the whole image
            </button>
          )}
          <button
            type="button"
            onClick={() => setBig(true)}
            className="text-[12.5px] text-ink-400 hover:text-ink-100"
          >
            Enlarge
          </button>
        </div>
      </div>
      <CropArea src={src} crop={crop} onChange={onChange} light={light} height="16rem" />
      <p className="text-[12.5px] leading-relaxed text-ink-400">{hint}</p>

      {big && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 p-6 backdrop-blur-sm"
          onClick={() => setBig(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-label="Crop"
            onClick={(e) => e.stopPropagation()}
            className="max-h-full w-full max-w-6xl space-y-3 overflow-y-auto rounded-xl border border-ink-700
                       bg-ink-900 p-5 shadow-2xl"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="label text-[13.5px] text-ink-300">Crop</h2>
              <div className="flex gap-4">
                {crop && (
                  <button
                    type="button"
                    onClick={() => onChange(null)}
                    className="text-[12.5px] text-ink-400 hover:text-ink-100"
                  >
                    Use the whole image
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBig(false)}
                  className="text-[12.5px] text-ink-400 hover:text-ink-100"
                >
                  Done
                </button>
              </div>
            </div>
            <CropArea src={src} crop={crop} onChange={onChange} light={light} height="calc(100vh - 12rem)" />
            <p className="text-[12.5px] leading-relaxed text-ink-400">{hint}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Which edges of the box a drag moves; all four is the whole box. */
interface Grab {
  l: boolean; r: boolean; t: boolean; b: boolean;
  from: { x: number; y: number };
  start: Box;
}

/** How near, in screen pixels, counts as on an edge or at the border. */
const GRAB_PX = 8;

function CropArea({
  src, crop, onChange, light, height,
}: {
  src: string;
  crop: Box | null;
  onChange: (b: Box | null) => void;
  light?: boolean;
  /** The tallest the picture may be shown, as a CSS length. */
  height: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const grab = useRef<Grab | null>(null);
  const [aspect, setAspect] = useState(1.5);
  const [cursor, setCursor] = useState('crosshair');

  /** Where the pointer is over the picture, unclamped, and the grab tolerance there. */
  const place = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return {
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
      tx: GRAB_PX / box.width,
      ty: GRAB_PX / box.height,
    };
  };

  // Close to the border counts as on it, and past it is held at it.
  const snap = (v: number, tol: number) => (v < tol ? 0 : v > 1 - tol ? 1 : v);

  /** Which edges of the current box are under the pointer, if any. */
  const hit = (p: { x: number; y: number; tx: number; ty: number }) => {
    if (!crop) return null;
    const x0 = crop.x, x1 = crop.x + crop.w, y0 = crop.y, y1 = crop.y + crop.h;
    const inX = p.x > x0 - p.tx && p.x < x1 + p.tx;
    const inY = p.y > y0 - p.ty && p.y < y1 + p.ty;
    if (!inX || !inY) return null;
    const l = Math.abs(p.x - x0) < p.tx, r = !l && Math.abs(p.x - x1) < p.tx;
    const t = Math.abs(p.y - y0) < p.ty, b = !t && Math.abs(p.y - y1) < p.ty;
    if (l || r || t || b) return { l, r, t, b };
    return { l: true, r: true, t: true, b: true };
  };

  const cursorFor = (h: ReturnType<typeof hit>) => {
    if (!h) return 'crosshair';
    if (h.l && h.r && h.t && h.b) return 'move';
    if ((h.l && h.t) || (h.r && h.b)) return 'nwse-resize';
    if ((h.r && h.t) || (h.l && h.b)) return 'nesw-resize';
    return h.l || h.r ? 'ew-resize' : 'ns-resize';
  };

  const onDown = (e: React.PointerEvent) => {
    const p = place(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const h = hit(p);
    if (h && crop) {
      grab.current = { ...h, from: { x: p.x, y: p.y }, start: crop };
      return;
    }
    // A new box, from the corner it starts at; that corner is its fixed one.
    const x = snap(p.x, p.tx), y = snap(p.y, p.ty);
    grab.current = { l: false, r: true, t: false, b: true, from: { x, y }, start: { x, y, w: 0, h: 0 } };
    onChange(null);
  };

  const onMove = (e: React.PointerEvent) => {
    const p = place(e);
    if (!p) return;
    const g = grab.current;
    if (!g) { setCursor(cursorFor(hit(p))); return; }
    const s = g.start;
    if (g.l && g.r && g.t && g.b) {
      // The whole box, kept inside the picture and drawn to the border near it.
      let x = s.x + p.x - g.from.x, y = s.y + p.y - g.from.y;
      x = Math.max(0, Math.min(1 - s.w, x));
      y = Math.max(0, Math.min(1 - s.h, y));
      if (x < p.tx) x = 0; else if (x + s.w > 1 - p.tx) x = 1 - s.w;
      if (y < p.ty) y = 0; else if (y + s.h > 1 - p.ty) y = 1 - s.h;
      onChange({ x, y, w: s.w, h: s.h });
      return;
    }
    const px = snap(p.x, p.tx), py = snap(p.y, p.ty);
    const x0 = g.l ? px : s.x, x1 = g.r ? px : s.x + s.w;
    const y0 = g.t ? py : s.y, y1 = g.b ? py : s.y + s.h;
    onChange({
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0),
      h: Math.abs(y1 - y0),
    });
  };

  const onUp = () => {
    grab.current = null;
    // A tap rather than a drag means the whole picture, not a sliver of it.
    if (crop && (crop.w < 0.02 || crop.h < 0.02)) onChange(null);
  };

  const pct = (v: number) => `${v * 100}%`;

  return (
    // The margin around the picture takes the pointer too, so a drag can start
    // beyond the edge and the box still lands exactly on it.
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="select-none p-3"
      style={{ cursor, touchAction: 'none' }}
    >
      <div
        ref={ref}
        // Exactly the picture's size, so the box is a fraction of the picture
        // and not of letterboxing around it.
        className={`relative mx-auto overflow-hidden rounded-md border border-ink-700
          ${light ? 'bg-[#e8e6df]' : 'bg-ink-950'}`}
        // As wide as there is room for, up to the given height, in proportion,
        // however small or large the picture is in its own pixels. Sized here
        // rather than by the picture, which would never grow past its pixels.
        style={{ width: `min(100%, calc(${height} * ${aspect}))` }}
        data-crop-picker=""
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src} alt="" draggable={false}
          onLoad={(e) => {
            const im = e.currentTarget;
            if (im.naturalWidth && im.naturalHeight) setAspect(im.naturalWidth / im.naturalHeight);
          }}
          className="block h-auto w-full"
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
            >
              {/* Corner handles, so it reads as something that can be taken hold of. */}
              {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy]) => (
                <span
                  key={`${cx}${cy}`}
                  className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-accent"
                  style={{ left: pct(cx), top: pct(cy) }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
