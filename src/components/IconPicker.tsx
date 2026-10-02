'use client';

import { useEffect, useState } from 'react';
import { panelHeightMm, panelWidthMm } from '@/lib/eurorack';
import { uid, type ArtElement } from '@/lib/types';
import { newElementAt, useStore } from '@/lib/store';
import {
  ICON_SETS, QUICK_ICONS, fetchIcon, fetchIcons, iconLabel, iconPreviewSrc, iconToRings, printableBody,
  searchIcons, type IconData,
} from '@/lib/icons';
import { Field } from './ui';

/**
 * Pick an icon and put it on the panel.
 *
 * The common ones are on show before anything is typed: waveforms, arrows,
 * power, clock — what a module panel uses icons for. Anything else is a
 * search away. A picked icon becomes outlines like traced artwork, so it is
 * moved, sized, turned, raised, engraved or set flush the same way.
 */
export function IconPicker() {
  const design = useStore((s) => s.design);
  const addDecor = useStore((s) => s.addDecor);
  const setError = useStore((s) => s.setError);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  // The icons on show, loaded a set at a time; null for one that failed.
  const [loaded, setLoaded] = useState<Record<string, IconData | null>>({});

  // Searched as you type, a moment after you stop, and only for the latest.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setSearching(false); return; }
    const ctrl = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchIcons(q, ctrl.signal)
        .then((icons) => { setResults(icons); setSearching(false); })
        .catch((e) => {
          if (ctrl.signal.aborted) return;
          setResults([]);
          setSearching(false);
          setError(e instanceof Error ? e.message : 'Icon search failed');
        });
    }, 400);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [query, setError]);

  const shown = results ?? QUICK_ICONS;

  useEffect(() => {
    let live = true;
    for (const [id, p] of fetchIcons(shown)) {
      p.then(
        (icon) => { if (live) setLoaded((m) => (m[id] === icon ? m : { ...m, [id]: icon })); },
        () => { if (live) setLoaded((m) => (id in m ? m : { ...m, [id]: null })); },
      );
    }
    return () => { live = false; };
  }, [shown]);

  // Only what can be printed is offered; one still loading keeps its place.
  const tiles = shown.filter((id) => loaded[id] !== null && (!loaded[id] || printableBody(loaded[id]!.body)));

  const add = async (id: string) => {
    setAdding(id);
    try {
      const rings = iconToRings(await fetchIcon(id));
      const at = newElementAt({ x: panelWidthMm(design.hp) / 2, y: panelHeightMm(design.format) / 2 });
      const el: ArtElement = {
        id: uid('a'),
        type: 'art',
        rings,
        x: at.x,
        y: at.y,
        scale: 1,
        rotation: 0,
        // Flush by default, like a new label.
        color: '#f2f2f0',
        mode: 'flush',
        reliefMm: 0.6,
        icon: id,
      };
      addDecor(el);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that icon');
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-2 border-t border-ink-800 pt-3" data-icon-picker="">
      <Field label="Add an icon">
        <input
          type="search"
          value={query}
          placeholder="Search icons — sine, arrow, power…"
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-[13.5px] outline-none
                     focus:border-accent"
        />
      </Field>

      {searching ? (
        <p className="text-[12.5px] text-ink-400">Searching…</p>
      ) : tiles.length === 0 ? (
        <p className="text-[12.5px] text-ink-400">No filled icons found for “{query.trim()}”.</p>
      ) : (
        <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
          {tiles.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => void add(id)}
              disabled={adding !== null}
              title={`${iconLabel(id)} (${id.split(':')[0]})`}
              aria-label={`Add icon ${iconLabel(id)}`}
              data-icon={id}
              // A panel-coloured tile, so the dark preview reads in either theme.
              className={`grid aspect-square place-items-center rounded border border-ink-700 bg-[#e8e6df]
                transition-colors hover:border-accent disabled:opacity-50
                ${adding === id ? 'border-accent' : ''}`}
            >
              {loaded[id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={iconPreviewSrc(loaded[id]!)} alt="" width={22} height={22} />
              )}
            </button>
          ))}
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-ink-400">
        Filled icons from {ICON_SETS.map((s) => `${s.name} (${s.license})`).join(', ')}, via Iconify.
      </p>
    </div>
  );
}
