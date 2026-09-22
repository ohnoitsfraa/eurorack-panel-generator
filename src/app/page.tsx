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

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'panel', label: 'Panel' },
  { id: 'features', label: 'Cutouts' },
  { id: 'decor', label: 'Text & art' },
  { id: 'export', label: 'Export' },
  { id: 'library', label: 'Rack' },
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
  const designName = useStore((s) => s.designName);
  const dirty = useStore((s) => s.dirty);
  const restoredAt = useStore((s) => s.restoredAt);
  const discardRestored = useStore((s) => s.discardRestored);
  const newDesign = useStore((s) => s.newDesign);
  const { result } = usePanelBuild();

  // localStorage is only reachable on the client, so the library and rack are
  // read after mount rather than as part of the store's initial state.
  // Local storage is only reachable on the client, so the library and rack are
  // read after mount rather than as part of the store's initial state.
  useEffect(() => { void loadLibraryFromStorage(); }, [loadLibraryFromStorage]);

  // Errors are transient notices, not state to manage; clear them after a beat.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 7000);
    return () => clearTimeout(t);
  }, [error, setError]);

  return (
    <div className="flex h-dvh flex-col bg-ink-950">
      <header className="flex shrink-0 items-center gap-4 border-b border-ink-800 px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight">
          Eurorack Panel Generator
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
              className={`rounded px-3 py-1 text-xs transition-colors
                ${view === v ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="truncate text-[11px] text-ink-400" title={designName}>
          {designName}{dirty ? ' ·' : ''}
        </span>


        <div className="ml-auto flex items-center gap-3 text-[11px] text-ink-400">
          {result.warnings.length > 0 && (
            <button
              type="button"
              onClick={() => setTab('export')}
              className="rounded border border-danger/50 px-2 py-1 text-danger hover:bg-danger/10"
            >
              {result.warnings.length} issue{result.warnings.length === 1 ? '' : 's'}
            </button>
          )}
          <span className="tabular-nums">{result.stats.triangles.toLocaleString()} triangles</span>
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
                <p className="text-xs text-ink-300">Analysing the panel…</p>
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
                className={`flex-1 border-b-2 px-1 py-2.5 text-[11px] transition-colors
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
                     border border-ink-700 bg-ink-850 px-4 py-2.5 text-xs text-ink-100 shadow-xl"
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
                     bg-ink-850 px-4 py-2.5 text-xs text-ink-100 shadow-xl"
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
