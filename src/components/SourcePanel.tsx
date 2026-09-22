'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { imageDataFromBlob } from '@/lib/cv/image';
import { Button, Field, NumberInput, Section, Select, Slider, Toggle } from './ui';
import { looksLikeLink, slugFromInput, type MGMatch, type MGModule } from '@/lib/modulargrid';

export function SourcePanel() {
  const sourceImage = useStore((s) => s.sourceImage);
  const sourceLabel = useStore((s) => s.sourceLabel);
  const setSource = useStore((s) => s.setSource);
  const clearSource = useStore((s) => s.clearSource);
  const setError = useStore((s) => s.setError);
  const loadFromUrl = useStore((s) => s.loadFromUrl);

  const [mode, setMode] = useState<'upload' | 'url' | 'modulargrid'>('upload');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const ingestFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('That file is not an image.');
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        const img = await imageDataFromBlob(file);
        // The file itself is kept, so the picture survives a refresh without
        // being re-encoded. The object URL is only for this page's lifetime.
        setSource(img, url, file.name, undefined, undefined, file);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read that image');
      }
    },
    [setSource, setError],
  );

  // Paste an image straight from the clipboard, which is how most people
  // get a module shot out of a browser.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void ingestFile(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [ingestFile]);

  return (
    <>
      <Section
        title="Source"
        right={
          sourceImage ? (
            <Button variant="ghost" onClick={clearSource}>Clear</Button>
          ) : undefined
        }
      >
        <div className="flex gap-1">
          {(['upload', 'url', 'modulargrid'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md border px-2 py-1 text-[11px] capitalize transition-colors
                ${mode === m
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-ink-700 bg-ink-900 text-ink-400 hover:text-ink-100'}`}
            >
              {m === 'modulargrid' ? 'ModularGrid' : m}
            </button>
          ))}
        </div>

        {mode === 'upload' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) void ingestFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer rounded-lg border border-dashed px-3 py-6 text-center transition-colors
              ${dragOver ? 'border-accent bg-accent/5' : 'border-ink-600 hover:border-ink-400'}`}
          >
            <p className="text-xs text-ink-300">Drop a module photo here</p>
            <p className="mt-1 text-[11px] text-ink-400">or click to browse · or just paste</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void ingestFile(f);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {mode === 'url' && <UrlLoader onLoad={loadFromUrl} />}
        {mode === 'modulargrid' && <ModularGridLoader />}

        {sourceLabel && (
          <p className="truncate text-[11px] text-ink-400" title={sourceLabel}>
            Loaded: {sourceLabel}
          </p>
        )}
      </Section>

      {sourceImage && <CropSection />}
      {sourceImage && <DetectSection />}
    </>
  );
}

function UrlLoader({ onLoad }: { onLoad: (url: string, label?: string) => Promise<void> }) {
  const loadFromUrl = useStore((s) => s.loadFromUrl);
  const setDesign = useStore((s) => s.setDesign);
  const setError = useStore((s) => s.setError);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  // A ModularGrid page is not an image, but pasting one here is an obvious
  // thing to do, so treat it as the module link it is rather than refusing it.
  const asModule = looksLikeLink(url) && slugFromInput(url) !== null;

  const go = async () => {
    const value = url.trim();
    if (!value) return;
    setBusy(true);
    try {
      if (asModule) {
        const result = await openModule(value, loadFromUrl, setDesign);
        if ('error' in result) setError(result.error);
      } else {
        await onLoad(value, value.split('/').pop() || 'Image');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        type="url"
        value={url}
        placeholder="https://…/module.jpg"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void go(); }}
        className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs outline-none
                   focus:border-accent"
      />
      <Button variant="primary" onClick={() => void go()} disabled={busy || !url.trim()} className="w-full">
        {busy ? 'Loading…' : asModule ? 'Open module' : 'Load image'}
      </Button>
      <p className="text-[11px] leading-relaxed text-ink-400">
        {asModule
          ? 'That is a ModularGrid module link — its panel image and width will be fetched.'
          : 'Fetched through this app so the canvas can read its pixels; a direct cross-origin image cannot be analysed.'}
      </p>
    </div>
  );
}

/**
 * Fetch a module from ModularGrid and load its panel.
 *
 * Shared by the ModularGrid tab and the plain URL field, so that pasting a
 * module link works wherever it is pasted. Without this the URL field sends
 * the page to the image proxy, which correctly refuses a lump of HTML, and the
 * user is told their perfectly good link could not be read.
 */
async function openModule(
  input: string,
  loadFromUrl: (url: string, label?: string, kind?: 'photo' | 'artwork', hp?: number) => Promise<void>,
  setDesign: (patch: { hp: number }) => void,
): Promise<{ module: MGModule } | { error: string; disabled?: boolean; notFound?: boolean }> {
  const res = await fetch(`/api/modulargrid/module?q=${encodeURIComponent(input.trim())}`);
  const data: MGModule & { error?: string; disabled?: boolean; notFound?: boolean } = await res.json();
  if (!res.ok) {
    return { error: data.error ?? 'Lookup failed', disabled: data.disabled, notFound: data.notFound };
  }

  if (data.hp) setDesign({ hp: data.hp });
  if (!data.imageUrl) return { error: `No panel image found for ${data.name}.` };

  // The panel shot is a drawing, and ModularGrid states the width, so neither
  // has to be guessed at.
  await loadFromUrl(data.imageUrl, data.name, 'artwork', data.hp);
  return { module: data };
}

/**
 * Load a module from ModularGrid by its link.
 *
 * Their search results are filtered against a browser session we cannot
 * reasonably stand in for, so rather than a search box that silently returns
 * the wrong modules, this hands the query to ModularGrid's own search and
 * takes the link back. One paste, and the panel image, name and HP all arrive.
 */
function ModularGridLoader() {
  const loadFromUrl = useStore((s) => s.loadFromUrl);
  const setDesign = useStore((s) => s.setDesign);
  const [input, setInput] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'off'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<MGMatch[] | null>(null);
  const [found, setFound] = useState<MGModule | null>(null);

  const isLink = looksLikeLink(input);
  const canGo = isLink || input.trim().length >= 3;

  /** Load one module, by link or by the address from a search result. */
  const open = async (ref: string, label?: string) => {
    setState('busy');
    setMessage(null);
    setFound(null);
    try {
      const result = await openModule(ref, loadFromUrl, setDesign);
      if ('error' in result) {
        setState(result.disabled ? 'off' : 'idle');
        setMessage(result.error);
        return;
      }
      setState('idle');
      setResults(null);
      setFound(result.module);
    } catch (e) {
      setState('idle');
      setMessage(e instanceof Error ? e.message : `Could not open ${label ?? 'that module'}.`);
    }
  };

  const go = async () => {
    if (!canGo) return;
    // A link is unambiguous, so it opens straight away; a name is searched for,
    // because several modules can answer to one and the choice is not ours.
    if (isLink) { await open(input); return; }

    setState('busy');
    setMessage(null);
    setResults(null);
    setFound(null);
    try {
      const res = await fetch(`/api/modulargrid/search?q=${encodeURIComponent(input.trim())}`);
      const data: { results?: MGMatch[]; error?: string; disabled?: boolean } = await res.json();
      if (!res.ok) {
        setState(data.disabled ? 'off' : 'idle');
        setMessage(data.error ?? 'Search failed');
        return;
      }
      setState('idle');
      setResults(data.results ?? []);
      if ((data.results ?? []).length === 0) {
        setMessage('Nothing matched. Try the maker as well as the model.');
      }
    } catch (e) {
      setState('idle');
      setMessage(e instanceof Error ? e.message : 'Could not reach ModularGrid.');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <input
          value={input}
          placeholder="Maths, Plaits, Disting…"
          onChange={(e) => { setInput(e.target.value); setResults(null); setMessage(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && canGo) void go(); }}
          className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs outline-none
                     focus:border-accent"
        />
        <Button onClick={() => void go()} disabled={!canGo || state === 'busy'}>
          {state === 'busy' ? '…' : isLink ? 'Open' : 'Search'}
        </Button>
      </div>

      {results && results.length > 0 && (
        <>
          <p className="text-[11px] text-ink-400">
            {results.length} match{results.length === 1 ? '' : 'es'} — pick one:
          </p>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {results.map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  onClick={() => void open(r.slug, r.name)}
                  disabled={state === 'busy'}
                  className="w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-left
                             text-[11px] text-ink-100 hover:border-ink-400 disabled:opacity-50"
                >
                  {r.name}
                  <span className="block truncate font-mono text-[10px] text-ink-400">{r.slug}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {found && (
        <p className="text-[11px] text-ink-400">
          Loaded <span className="text-ink-100">{found.name}</span>
          {found.hp ? ` · ${found.hp} HP` : ''}
        </p>
      )}

      {state === 'off' && (
        <div className="rounded-md border border-ink-700 bg-ink-900 p-2.5 text-[11px] leading-relaxed text-ink-300">
          <p className="mb-1 font-medium text-ink-100">ModularGrid lookup is off</p>
          <p className="text-ink-400">
            Set <code className="rounded bg-ink-800 px-1">MODULARGRID_ENABLED=1</code> to turn it
            on. Uploading a photo or pasting an image URL works either way.
          </p>
        </div>
      )}

      {message && state !== 'off' && <p className="text-[11px] text-danger">{message}</p>}

      <p className="text-[11px] leading-relaxed text-ink-400">
        Searches ModularGrid&apos;s own index of pages, refreshed twice a day and
        held here in between, so typing costs their servers nothing.
      </p>
    </div>
  );
}

/**
 * Crop adjustment.
 *
 * The crop is what sets the millimetre scale, so getting it tight to the panel
 * edges matters more than it looks: a 5% error in the crop is a 5% error in
 * every detected hole diameter.
 */
function CropSection() {
  const sourceImage = useStore((s) => s.sourceImage);
  const crop = useStore((s) => s.crop);
  const setCrop = useStore((s) => s.setCrop);
  const runDetection = useStore((s) => s.runDetection);
  const [preview, setPreview] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ edge: string; startX: number; startY: number; orig: typeof crop } | null>(null);

  useEffect(() => {
    if (!sourceImage) { setPreview(null); return; }
    const c = document.createElement('canvas');
    c.width = sourceImage.width;
    c.height = sourceImage.height;
    c.getContext('2d')?.putImageData(sourceImage, 0, 0);
    setPreview(c.toDataURL('image/png'));
  }, [sourceImage]);

  if (!sourceImage || !crop || !preview) return null;
  const iw = sourceImage.width;
  const ih = sourceImage.height;

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  const onHandleDown = (edge: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { edge, startX: e.clientX, startY: e.clientY, orig: crop };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const box = boxRef.current;
    if (!d || !d.orig || !box) return;
    const rect = box.getBoundingClientRect();
    const dx = ((e.clientX - d.startX) / rect.width) * iw;
    const dy = ((e.clientY - d.startY) / rect.height) * ih;
    const o = d.orig;
    let { x, y, w, h } = o;

    if (d.edge === 'move') { x = o.x + dx; y = o.y + dy; }
    if (d.edge.includes('l')) { x = o.x + dx; w = o.w - dx; }
    if (d.edge.includes('r')) { w = o.w + dx; }
    if (d.edge.includes('t')) { y = o.y + dy; h = o.h - dy; }
    if (d.edge.includes('b')) { h = o.h + dy; }

    // Keep the box on the image and never let it collapse.
    w = Math.max(16, Math.min(w, iw));
    h = Math.max(16, Math.min(h, ih));
    x = Math.max(0, Math.min(x, iw - w));
    y = Math.max(0, Math.min(y, ih - h));
    setCrop({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  };

  const handles: Array<[string, string]> = [
    ['tl', 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'],
    ['tr', 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'],
    ['bl', 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'],
    ['br', 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'],
  ];

  return (
    <Section
      title="Crop to panel edges"
      right={<Button variant="ghost" onClick={runDetection}>Re-detect</Button>}
    >
      <div
        ref={boxRef}
        className="relative select-none overflow-hidden rounded-md border border-ink-700 bg-ink-950"
        onPointerMove={onMove}
        onPointerUp={() => { dragRef.current = null; }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Source" className="block w-full opacity-45" draggable={false} />
        <div
          className="absolute border-2 border-accent"
          style={{ left: pct(crop.x, iw), top: pct(crop.y, ih), width: pct(crop.w, iw), height: pct(crop.h, ih) }}
          onPointerDown={onHandleDown('move')}
        >
          <div className="absolute inset-0 cursor-move" />
          {handles.map(([edge, cls]) => (
            <div
              key={edge}
              onPointerDown={onHandleDown(edge)}
              className={`absolute h-3 w-3 rounded-sm border border-ink-950 bg-accent ${cls}`}
            />
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-400">
        The crop sets the millimetre scale, so trim it to the actual panel
        edges. Everything detected is measured against it.
      </p>
    </Section>
  );
}

function DetectSection() {
  const detect = useStore((s) => s.detect);
  const setDetect = useStore((s) => s.setDetect);
  const runDetection = useStore((s) => s.runDetection);
  const detecting = useStore((s) => s.detecting);
  const mmPerPx = useStore((s) => s.mmPerPx);
  const droppedAsMarkings = useStore((s) => s.droppedAsMarkings);
  const showSource = useStore((s) => s.showSource);
  const setShowSource = useStore((s) => s.setShowSource);
  const sourceOpacity = useStore((s) => s.sourceOpacity);
  const setSourceOpacity = useStore((s) => s.setSourceOpacity);

  return (
    <Section title="Detection">
      <Field label="What kind of image is this?">
        <Select
          value={detect.sourceKind}
          onChange={(sourceKind) => { setDetect({ sourceKind }); runDetection(); }}
          options={[
            { value: 'photo', label: 'Photo of a built module' },
            { value: 'artwork', label: 'Panel artwork or render' },
          ]}
        />
      </Field>
      <p className="-mt-1 text-[11px] leading-relaxed text-ink-400">
        {detect.sourceKind === 'artwork'
          ? 'Drawings show the socket opening rather than the nut around it, so a jack measures about 4 mm instead of 8 mm. Printed graphics can also look like holes, so expect to delete a few.'
          : 'Sizes are matched against the fitted hardware you can see: a jack’s nut, a knob, an LED lens.'}
      </p>

      <Field label="Sensitivity" hint={detect.sensitivity.toFixed(2)}>
        <Slider
          min={0} max={1} step={0.05}
          value={detect.sensitivity}
          onChange={(v) => setDetect({ sensitivity: v })}
        />
      </Field>
      <p className="-mt-1 text-[11px] leading-relaxed text-ink-400">
        Higher finds more holes and more false ones. Anything the detector is
        unsure of is outlined in red on the canvas.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Min size" hint="mm">
          <NumberInput value={detect.minSizeMm} onChange={(v) => setDetect({ minSizeMm: v })} min={0.5} max={20} step={0.5} />
        </Field>
        <Field label="Max size" hint="mm">
          <NumberInput value={detect.maxSizeMm} onChange={(v) => setDetect({ maxSizeMm: v })} min={4} max={120} step={1} />
        </Field>
      </div>

      <Toggle checked={detect.detectSlots} onChange={(v) => setDetect({ detectSlots: v })} label="Find sliders and slots" />
      <Toggle checked={detect.detectRects} onChange={(v) => setDetect({ detectRects: v })} label="Find rectangular cutouts" />

      <Field label="Snap detected holes to grid">
        <Select
          value={String(detect.snapMm)}
          onChange={(v) => setDetect({ snapMm: Number(v) })}
          options={[
            { value: '0', label: 'Off' },
            { value: '0.5', label: '0.5 mm' },
            { value: '1', label: '1 mm' },
            { value: '2.54', label: '2.54 mm (half HP)' },
            { value: '5.08', label: '5.08 mm (1 HP)' },
          ]}
        />
      </Field>

      <Button variant="primary" onClick={runDetection} disabled={detecting} className="w-full">
        {detecting ? 'Analysing…' : 'Detect cutouts'}
      </Button>

      {mmPerPx && (
        <p className="text-[11px] tabular-nums text-ink-400">
          Scale: {(1 / mmPerPx).toFixed(1)} px/mm
        </p>
      )}

      {droppedAsMarkings > 0 && (
        <p className="text-[11px] leading-relaxed text-ink-400">
          {droppedAsMarkings} mark{droppedAsMarkings === 1 ? '' : 's'} ignored as printing —
          lettering and logos look like small holes, but holes that would run
          into each other cannot both be real.
        </p>
      )}

      <div className="border-t border-ink-800 pt-3">
        <Toggle checked={showSource} onChange={setShowSource} label="Show photo underlay" />
        {showSource && (
          <Field label="Underlay opacity" hint={`${Math.round(sourceOpacity * 100)}%`}>
            <Slider min={0} max={1} step={0.05} value={sourceOpacity} onChange={setSourceOpacity} />
          </Field>
        )}
      </div>
    </Section>
  );
}
