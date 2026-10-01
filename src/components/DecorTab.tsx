'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { panelHeightMm, panelWidthMm } from '@/lib/eurorack';
import { uid, type ArtElement, type ReliefMode, type ShapeElement, type TextElement } from '@/lib/types';
import { useStore } from '@/lib/store';
import { traceArtwork } from '@/lib/model/trace';
import { FONT_FAMILIES, FONT_WEIGHTS } from '@/lib/fonts';
import { Button, ColorInput, Field, NumberInput, Section, Select, Slider } from './ui';

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
  const addShapeElement = useStore((s) => s.addShapeElement);
  const removeDecor = useStore((s) => s.removeDecor);
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);

  const W = panelWidthMm(design.hp);
  const H = panelHeightMm(design.format);

  const selected = decor.find((d) => selectedIds.includes(d.id));

  return (
    <>
      <Section title="Add">
        <div className="grid grid-cols-2 gap-1">
          <Button onClick={addTextLabel}>Text label</Button>
          <Button onClick={addShapeElement}>Line / shape</Button>
        </div>
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
                  onClick={() => select([d.id])}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-[12.5px]
                    ${selectedIds.includes(d.id) ? 'bg-accent/15 text-accent' : 'text-ink-300 hover:bg-ink-800'}`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm border border-ink-600"
                    style={{ background: d.color }}
                  />
                  <span className="truncate">
                    {d.type === 'text' ? d.text || '(empty)' : d.type === 'art' ? 'Traced artwork' : d.shape}
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
      </Section>

      {selected && <DecorEditor id={selected.id} />}
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
                onChange={(fontFamily) => { update(id, { fontFamily }); ensureFont(fontFamily, el.fontWeight); }}
                options={fontOptions(customFonts, el.type === 'text' ? el.fontFamily : '')}
              />
            </Field>
            <Field label="Weight">
              <Select
                value={String(el.fontWeight)}
                onChange={(w) => { update(id, { fontWeight: Number(w) }); ensureFont(el.fontFamily, Number(w)); }}
                options={FONT_WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))}
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
            Traced artwork: {el.rings.length} outline{el.rings.length === 1 ? '' : 's'}. Re-trace
            from the Add section to change the threshold.
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
        <Slider min={-180} max={180} step={1} value={el.rotation} onChange={(rotation) => update(id, { rotation })} />
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

  return (
    <div className="space-y-2 border-t border-ink-800 pt-3">
      <Field label="Trace an image into relief">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCrop(null); }}
          className="w-full text-[12.5px] text-ink-400 file:mr-2 file:rounded file:border-0
                     file:bg-ink-700 file:px-2 file:py-1 file:text-[12.5px] file:text-ink-100"
        />
      </Field>

      {file && preview && (
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
  src, crop, onChange,
}: { src: string; crop: Box | null; onChange: (b: Box | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const from = useRef<{ x: number; y: number } | null>(null);

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
        className="relative select-none overflow-hidden rounded-md border border-ink-700 bg-ink-950"
        style={{ cursor: 'crosshair', touchAction: 'none' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} className="block max-h-48 w-full object-contain" />
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
