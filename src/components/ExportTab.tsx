'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { meshesForExport, usePanelBuild } from '@/lib/usePanelBuild';
import { download3MF, downloadSTL, downloadSTLSet } from '@/lib/export/download';
import { meshesTo3MF } from '@/lib/export/threemf';
import { meshesToBinarySTL } from '@/lib/export/stl';
import { Button, Field, PendingFonts, Section } from './ui';

export function ExportTab() {
  const design = useStore((s) => s.design);
  const sourceLabel = useStore((s) => s.sourceLabel);
  const { result } = usePanelBuild();
  const [name, setName] = useState('');

  const filename = useMemo(() => {
    const base = name.trim() || sourceLabel?.replace(/\.[a-z0-9]+$/i, '') || 'panelmate-panel';
    return `${base.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'panel'}-${design.hp}hp`;
  }, [name, sourceLabel, design.hp]);

  const colorCount = new Set(result.meshes.map((m) => m.color.toLowerCase())).size;

  const sizes = useMemo(() => {
    // Measured rather than estimated, so the numbers shown are the real ones.
    try {
      return {
        stl: meshesToBinarySTL(result.meshes, filename).byteLength,
        mf: meshesTo3MF(result.meshes, { title: filename }).byteLength,
      };
    } catch {
      return null;
    }
  }, [result, filename]);

  return (
    <>
      {result.pending.length > 0 && (
        <Section title="Lettering">
          <PendingFonts families={result.pending} />
        </Section>
      )}

      {result.warnings.length > 0 && (
        <Section title="Needs attention">
          <ul className="space-y-2">
            {result.warnings.map((w, i) => (
              <li
                key={i}
                className="rounded-md border border-danger/40 bg-danger/5 px-2.5 py-2 text-[12.5px]
                           leading-relaxed text-ink-100"
              >
                {w}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Model">
        <dl className="grid grid-cols-2 gap-y-2 text-[12.5px]">
          <dt className="text-ink-400">Panel size</dt>
          <dd className="tabular-nums text-ink-100">
            {result.stats.widthMm.toFixed(2)} × {result.stats.heightMm.toFixed(2)} mm
          </dd>
          <dt className="text-ink-400">Thickness</dt>
          <dd className="tabular-nums text-ink-100">{design.thicknessMm.toFixed(1)} mm</dd>
          <dt className="text-ink-400">Cutouts</dt>
          <dd className="tabular-nums text-ink-100">{result.stats.holes}</dd>
          <dt className="text-ink-400">Objects</dt>
          <dd className="tabular-nums text-ink-100">{result.meshes.length}</dd>
          <dt className="text-ink-400">Colours</dt>
          <dd className="tabular-nums text-ink-100">{colorCount}</dd>
          <dt className="text-ink-400">Triangles</dt>
          <dd className="tabular-nums text-ink-100">{result.stats.triangles.toLocaleString()}</dd>
        </dl>
      </Section>

      <Section title="Export">
        <Field label="File name">
          <input
            value={name}
            placeholder={filename}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-[15px] outline-none
                       focus:border-accent"
          />
        </Field>

        <div className="space-y-2 pt-1">
          <Button variant="primary" onClick={async () => download3MF(await meshesForExport(), filename)} className="w-full">
            Download 3MF{sizes ? ` · ${kb(sizes.mf)}` : ''}
          </Button>
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Keeps millimetre units, separate objects and colours, so a
            multi-material printer picks up the material assignments directly.
            This is the one to use.
          </p>
        </div>

        <div className="space-y-2 border-t border-ink-800 pt-3">
          <Button onClick={async () => downloadSTL(await meshesForExport(), filename)} className="w-full">
            Download STL{sizes ? ` · ${kb(sizes.stl)}` : ''}
          </Button>
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Everything merged into one solid. STL carries no colour.
          </p>
        </div>

        {colorCount > 1 && (
          <div className="space-y-2">
            <Button onClick={async () => downloadSTLSet(await meshesForExport(), filename)} className="w-full">
              Download STL set · zip
            </Button>
            <p className="text-[12.5px] leading-relaxed text-ink-400">
              One STL per colour ({colorCount} files). Load them together in
              your slicer and assign a material to each.
            </p>
          </div>
        )}
      </Section>

      <Section title="Printing notes">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-ink-400">
          <li>
            <span className="text-ink-100">Print face down</span> on a smooth
            plate. The first layer becomes the visible front, so it comes out
            flat and even without supports.
          </li>
          <li>
            <span className="text-ink-100">Jack nuts need the full thickness.</span>{' '}
            2 mm matches an aluminium panel and fits standard 3.5 mm jack
            hardware; much thicker and the nut may not reach.
          </li>
          <li>
            <span className="text-ink-100">Check the holes on a test strip</span>{' '}
            before printing the whole panel. Printers shrink holes slightly, so
            you may want to add 0.1–0.2 mm to the diameters.
          </li>
          <li>
            <span className="text-ink-100">Relief of 0.4–0.6 mm</span> reads
            clearly at arm's length and costs almost nothing in print time.
          </li>
        </ul>
      </Section>
    </>
  );
}

function kb(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
