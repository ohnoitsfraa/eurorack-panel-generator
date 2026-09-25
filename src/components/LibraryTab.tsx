'use client';

import { useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { buildRack } from '@/lib/model/rackBuild';
import { fontsSettled } from '@/lib/model/text';
import { panelAspect } from '@/lib/rack';
import { download3MF, downloadSTL, downloadSTLSet } from '@/lib/export/download';
import { PanelThumb } from './PanelThumb';
import { Button, Field, PendingFonts, Section } from './ui';

/** Saved panels, and everything to do with the rack as a whole. */
export function LibraryTab() {
  const library = useStore((s) => s.library);
  const rack = useStore((s) => s.rack);
  const fonts = useStore((s) => s.fonts);
  const activeDesignId = useStore((s) => s.activeDesignId);
  const openDesign = useStore((s) => s.openDesign);
  const deleteDesign = useStore((s) => s.deleteDesign);
  const addToRack = useStore((s) => s.addToRack);
  const exportPanel = useStore((s) => s.exportPanel);
  const setView = useStore((s) => s.setView);
  const setTab = useStore((s) => s.setTab);

  /**
   * Put a panel in the rack and go and look at it.
   *
   * Only on success: when there is no room the panel has not moved, and
   * switching to a rack that looks unchanged reads as the click having done
   * nothing. The error says what happened instead.
   */
  const placeAndShow = (id: string) => {
    if (!addToRack(id)) return;
    setView('rack');
    setTab('library');
  };
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const placedCount = useMemo(
    () => rack.rows.reduce((n, r) => n + r.placements.length, 0),
    [rack],
  );

  return (
    <>
      <Section title={`Library (${library.length})`}>
        {library.length === 0 ? (
          <p className="py-2 text-center text-[13.5px] leading-relaxed text-ink-400">
            Nothing saved yet. Name this panel and save it, then it can go in a rack.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {library.map((item) => (
              <li
                key={item.id}
                className={`rounded-md border p-1.5
                  ${item.id === activeDesignId ? 'border-accent/60 bg-accent/5' : 'border-ink-700 bg-ink-900'}`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-10 shrink-0 overflow-hidden rounded bg-ink-950"
                    // Width follows the panel's own proportions, so a 4 HP
                    // blank and a 20 HP module are visibly different shapes.
                    style={{ width: `${40 * panelAspect(item.design.hp, item.design.format)}px` }}
                  >
                    <PanelThumb design={item.design} fonts={fonts} className="h-full w-full" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] text-ink-100">{item.name}</p>
                    <p className="label text-[11.5px] tabular-nums text-ink-400">
                      {item.design.hp} HP · {item.design.features.length} cutouts
                    </p>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-1">
                  <Button onClick={() => openDesign(item.id)} className="flex-1">Open</Button>
                  <Button onClick={() => placeAndShow(item.id)} className="flex-1">To rack</Button>
                  <Button onClick={() => exportPanel(item.id)} title="Export this panel to a file">↓</Button>
                  {confirmDelete === item.id ? (
                    <Button variant="danger" onClick={() => { deleteDesign(item.id); setConfirmDelete(null); }}>
                      Sure?
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmDelete(item.id)} title="Delete">×</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <BackupSection />

      {placedCount > 0 && <RackExport />}
    </>
  );
}

/**
 * Files in and out.
 *
 * Panels live in this browser, which is fine until the browser is cleared or
 * you want the same panel on another machine. Exporting writes plain JSON, so
 * a file is a backup, a way to move between machines, and something you can
 * hand to someone else — or read yourself, since it is not an opaque blob.
 */
function BackupSection() {
  const library = useStore((s) => s.library);
  const rack = useStore((s) => s.rack);
  const exportRack = useStore((s) => s.exportRack);
  const exportEverything = useStore((s) => s.exportEverything);
  const importBackup = useStore((s) => s.importBackup);
  const lastImport = useStore((s) => s.lastImport);
  const setError = useStore((s) => s.setError);

  const [asCopy, setAsCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const placed = rack.rows.reduce((n, r) => n + r.placements.length, 0);

  const take = async (file: File) => {
    setBusy(true);
    try {
      await importBackup(await file.text(), { asCopy });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Export &amp; import">
      <div className="grid grid-cols-2 gap-1">
        <Button onClick={exportEverything} disabled={library.length === 0}>
          Export all
        </Button>
        <Button onClick={exportRack} disabled={placed === 0}>
          Export rack
        </Button>
      </div>
      <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-400">
        A rack file carries the panels it uses, so it opens complete on another
        machine. Single panels export from the ↓ button on each one.
      </p>

      <div className="border-t border-ink-800 pt-3">
        <Button onClick={() => fileRef.current?.click()} disabled={busy} className="w-full">
          {busy ? 'Reading…' : 'Import a file'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void take(f);
            e.target.value = '';
          }}
        />
        <label className="mt-2 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-300">
          <input
            type="checkbox"
            checked={asCopy}
            onChange={(e) => setAsCopy(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Import as copies
            <span className="block text-ink-400">
              Keeps whatever you already have and brings the file in alongside it.
              Leave this off to restore a backup over the top.
            </span>
          </span>
        </label>
      </div>

      {lastImport && (
        <p className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-100">
          Imported: {lastImport.added} added, {lastImport.updated} updated,{' '}
          {lastImport.unchanged} already current
          {lastImport.rackReplaced ? ', rack replaced' : ''}.
        </p>
      )}

      <p className="text-[12.5px] leading-relaxed text-ink-400">
        Panels are kept in this browser's local database. Exporting is how they
        survive clearing site data or move to another machine.
      </p>
    </Section>
  );
}

function RackExport() {
  const rack = useStore((s) => s.rack);
  const library = useStore((s) => s.library);
  const fonts = useStore((s) => s.fonts);

  const result = useMemo(() => buildRack(rack, library, fonts), [rack, library, fonts]);

  // Same reasoning as the single-panel export: the preview may be missing a
  // label for a moment, the file may not.
  const meshesForExport = async () => {
    await fontsSettled();
    const s = useStore.getState();
    return buildRack(s.rack, s.library, s.fonts).meshes;
  };
  const name = (rack.name || 'rack').replace(/[^\w.-]+/g, '-').toLowerCase();

  return (
    <Section title="Export the whole rack">
      <dl className="grid grid-cols-2 gap-y-1.5 text-[12.5px]">
        <dt className="text-ink-400">Panels</dt>
        <dd className="tabular-nums text-ink-100">{result.stats.panels}</dd>
        <dt className="text-ink-400">Extent</dt>
        <dd className="tabular-nums text-ink-100">
          {result.stats.widthMm.toFixed(0)} × {result.stats.heightMm.toFixed(0)} mm
        </dd>
        <dt className="text-ink-400">Triangles</dt>
        <dd className="tabular-nums text-ink-100">{result.stats.triangles.toLocaleString()}</dd>
      </dl>

      <Button variant="primary" onClick={async () => download3MF(await meshesForExport(), `${name}-rack`)} className="w-full">
        Download rack as 3MF
      </Button>
      <div className="grid grid-cols-2 gap-1">
        <Button onClick={async () => downloadSTL(await meshesForExport(), `${name}-rack`)}>STL</Button>
        <Button onClick={async () => downloadSTLSet(await meshesForExport(), `${name}-rack`)}>STL set</Button>
      </div>

      <p className="text-[12.5px] leading-relaxed text-ink-400">
        Panels are arranged as they sit in the rack, which is right for checking
        the whole front but wider than most print beds — a full 84 HP row is
        427 mm. For printing, export panels one at a time from the Export tab,
        or let your slicer rearrange the objects.
      </p>

      <PendingFonts families={result.pending} />

      {result.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {[...new Set(result.warnings)].map((w, i) => (
            <li key={i} className="rounded border border-danger/40 bg-danger/5 px-2 py-1.5 text-[12.5px] text-ink-100">
              {w}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
