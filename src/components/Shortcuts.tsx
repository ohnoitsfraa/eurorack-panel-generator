'use client';

import { useEffect, useState } from 'react';

/**
 * Every shortcut, on request.
 *
 * A panel rather than a line of hints along the chrome: there are enough of
 * these now that listing them in the interface would cost more room than they
 * save, and the one thing somebody needs to discover is how to ask.
 */
const GROUPS: Array<{ title: string; keys: Array<[string, string]> }> = [
  {
    title: 'Place',
    keys: [
      ['C', 'Circle'],
      ['R', 'Rectangle'],
      ['U', 'Rounded rectangle'],
      ['S', 'Slot'],
      ['T', 'Text label'],
      ['L', 'Line'],
    ],
  },
  {
    title: 'Edit',
    keys: [
      ['Double-click', 'Type into a label'],
      ['Arrows', 'Nudge by the grid pitch'],
      ['Shift + arrows', 'Nudge five steps'],
      ['⌘ D', 'Duplicate'],
      ['Alt + drag', 'Drag off a copy'],
      ['Backspace', 'Delete'],
      ['Esc', 'Drop the tool and the selection'],
    ],
  },
  {
    title: 'Panel',
    keys: [
      ['⌘ Z', 'Undo'],
      ['⌘ ⇧ Z', 'Redo'],
      ['⌘ S', 'Save to the library'],
    ],
  },
  {
    title: 'View',
    keys: [
      ['⌘ scroll', 'Zoom the canvas'],
      ['Scroll', 'Move around the canvas'],
      ['Space + drag', 'Move around, from anywhere'],
      ['⌘ drag empty space', 'Move around'],
      ['⌘ drag a part', 'Ignore the grid and the guides'],
      ['?', 'This list'],
    ],
  },
];

export function Shortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      // Both ways of asking: the question mark, and the slash that is under it
      // on most keyboards, with or without the modifier.
      if (e.key === '?' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ink-700
                   text-[12.5px] text-ink-400 transition-colors hover:border-ink-400 hover:text-ink-100"
      >
        ?
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 p-6 backdrop-blur-sm"
          // Anywhere outside closes it, which is what the backdrop is for.
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-label="Keyboard shortcuts"
            onClick={(e) => e.stopPropagation()}
            className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-ink-700
                       bg-ink-900 p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="label text-[13.5px] text-ink-300">Keyboard shortcuts</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[12.5px] text-ink-400 hover:text-ink-100"
              >
                Esc to close
              </button>
            </div>

            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <section key={g.title}>
                  <h3 className="label mb-2 text-[11.5px] text-ink-400">{g.title}</h3>
                  <dl className="space-y-1.5">
                    {g.keys.map(([key, what]) => (
                      <div key={key} className="flex items-baseline justify-between gap-4">
                        <dd className="text-[13.5px] text-ink-100">{what}</dd>
                        <dt className="shrink-0">
                          <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5
                                          font-mono text-[11.5px] text-ink-300">
                            {key}
                          </kbd>
                        </dt>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
