'use client';

import { useEffect } from 'react';
import { useStore, type InspectorTab } from '@/lib/store';
import { PanelCanvas2D } from '@/components/PanelCanvas2D';
import { Preview3D } from '@/components/Preview3D';
import { SourcePanel } from '@/components/SourcePanel';
import { FeaturesTab, PanelTab } from '@/components/InspectorPanel';
import { DecorTab } from '@/components/DecorTab';
import { ExportTab } from '@/components/ExportTab';
import { LibraryTab } from '@/components/LibraryTab';
import { RackView } from '@/components/RackView';
import { usePanelBuild } from '@/lib/usePanelBuild';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { PanelIdentity } from '@/components/PanelIdentity';

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'panel', label: 'Panel' },
  { id: 'features', label: 'Cutouts' },
  { id: 'decor', label: 'Text & art' },
  { id: 'export', label: 'Export' },
  { id: 'library', label: 'Library' },
];

export default function Page() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const detecting = useStore((s) => s.detecting);
  const loadLibraryFromStorage = useStore((s) => s.loadLibraryFromStorage);
  const restoredAt = useStore((s) => s.restoredAt);
  const discardRestored = useStore((s) => s.discardRestored);
  const newDesign = useStore((s) => s.newDesign);
  const { result } = usePanelBuild();

  // localStorage is only reachable on the client, so the library and rack are
  // read after mount rather than as part of the store's initial state.
  // Local storage is only reachable on the client, so the library and rack are
  // read after mount rather than as part of the store's initial state.
  useEffect(() => { void loadLibraryFromStorage(); }, [loadLibraryFromStorage]);

  /**
   * The three shortcuts that work wherever you are in the app.
   *
   * Here rather than on the canvas because they should hold in the 3D preview
   * and in the rack too — somebody who has just typed a name and reaches for
   * Cmd-S should not have to think about which view is up.
   *
   * Skipped while a caret is in a box: the browser's own undo inside a text
   * field is the better one, and Cmd-S there still means save.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      const k = e.key.toLowerCase();

      if (k === 's') {
        e.preventDefault();
        useStore.getState().saveCurrentDesign();
        return;
      }
      if (k === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * One key each for the things you reach for most while laying a panel out.
   *
   * Letters chosen from the names rather than from a row on the keyboard, so
   * they can be guessed: C for circle, R for rectangle, S for slot, T for a
   * text label. The two that have no initial left take the next best thing —
   * U for a roUnded rectangle, L for a line.
   *
   * A shape key arms the tool and the next click on the panel places it, which
   * is how the buttons already work. A label is placed outright, because there
   * is nowhere sensible for it to wait.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;

      const s = useStore.getState();
      const tool = { c: 'circle', r: 'rect', u: 'roundrect', s: 'slot' } as const;
      const k = e.key.toLowerCase();

      if (k in tool) {
        e.preventDefault();
        s.setView('2d');
        s.setTab('features');
        s.setTool(tool[k as keyof typeof tool]);
        return;
      }
      if (k === 't' || k === 'l') {
        e.preventDefault();
        s.setView('2d');
        s.setTab('decor');
        if (k === 't') s.addTextLabel();
        else s.addShapeElement();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Errors are transient notices, not state to manage; clear them after a beat.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 7000);
    return () => clearTimeout(t);
  }, [error, setError]);

  return (
    <div className="flex h-dvh flex-col bg-ink-950">
      <header className="flex shrink-0 items-center gap-4 border-b border-ink-800 px-4 py-2.5">
        {/* The lockup, in the kit's proportions: the wordmark's ink is 0.63
            of the mark's height and stands 0.385 of it away, both measured off
            lockup-dark.svg. It is live text rather than the kit's outlined
            copy — same face, same weight, same tracking, a fifth of the bytes
            — and 23px is the size whose ink box comes out at that 0.63. */}
        <h1 className="flex shrink-0 items-center gap-[12.3px]">
          <Logo className="h-8 w-8" />
          <span
            className="text-[23px] font-bold leading-none tracking-[-0.045em] text-ink-100"
            // The kit centres mark and wordmark on the same line. Live text
            // centres its line box instead, and "panelmate" has more above the
            // baseline than below, which leaves its ink sitting 1.2px low.
            style={{ fontVariationSettings: "'opsz' 96", transform: 'translateY(-1.2px)' }}
          >
            panelmate
          </span>
        </h1>

        <div className="flex rounded-md border border-ink-700 p-0.5">
          {([
            ['2d', 'Layout'],
            ['3d', '3D preview'],
            ['rack', 'Rack'],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => { setView(v); if (v === 'rack') setTab('library'); }}
              className={`label whitespace-nowrap rounded px-3 py-1 text-[12.5px] transition-colors
                ${view === v ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <PanelIdentity />

        <div className="ml-auto flex shrink-0 items-center gap-3 text-[12.5px] text-ink-400">
          <ThemeToggle />
          {result.warnings.length > 0 && (
            <button
              type="button"
              onClick={() => setTab('export')}
              className="rounded border border-danger/50 px-2 py-1 text-danger hover:bg-danger/10"
            >
              {result.warnings.length} issue{result.warnings.length === 1 ? '' : 's'}
            </button>
          )}
          <span className="label whitespace-nowrap tabular-nums">{result.stats.triangles.toLocaleString()} triangles</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {view !== 'rack' && (
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-ink-800 bg-ink-900">
            <SourcePanel />
          </aside>
        )}

        <main className="relative min-w-0 flex-1">
          {view === '2d' && <PanelCanvas2D />}
          {view === '3d' && <Preview3D />}
          {view === 'rack' && <RackView />}

          {detecting && (
            <div className="absolute inset-0 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
              <div className="text-center">
                <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-ink-600 border-t-accent" />
                <p className="text-[13.5px] text-ink-300">Analysing the panel…</p>
              </div>
            </div>
          )}
        </main>

        <aside className="flex w-80 shrink-0 flex-col border-l border-ink-800 bg-ink-900">
          <nav className="flex shrink-0 border-b border-ink-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 whitespace-nowrap border-b-2 px-1 py-2.5 text-[12px] transition-colors
                  ${tab === t.id
                    ? 'border-accent text-ink-100'
                    : 'border-transparent text-ink-400 hover:text-ink-100'}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'panel' && <PanelTab />}
            {tab === 'features' && <FeaturesTab />}
            {tab === 'decor' && <DecorTab />}
            {tab === 'export' && <ExportTab />}
            {tab === 'library' && <LibraryTab />}
          </div>
        </aside>
      </div>

      {restoredAt !== null && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg
                     border border-ink-700 bg-ink-850 px-4 py-2.5 text-[13.5px] text-ink-100 shadow-xl"
        >
          <span>Picked up where you left off.</span>
          <button
            type="button"
            onClick={() => { newDesign(); }}
            className="text-ink-400 underline-offset-2 hover:text-ink-100 hover:underline"
          >
            Start a new panel
          </button>
          <button
            type="button"
            onClick={discardRestored}
            className="text-ink-400 hover:text-ink-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-danger/50
                     bg-ink-850 px-4 py-2.5 text-[13.5px] text-ink-100 shadow-xl"
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 text-ink-400 hover:text-ink-100"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
