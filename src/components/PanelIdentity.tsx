'use client';

import { useStore } from '@/lib/store';
import { Button } from './ui';

/**
 * Name the panel, save it, start another.
 *
 * In the header because these three belong to whatever is on screen rather
 * than to any one inspector tab: you can be drawing cutouts, looking at the
 * 3D preview or standing in the rack and still want to save what you have.
 * They also replace the header's old read-only name, which said the same
 * thing without letting you change it.
 */
export function PanelIdentity() {
  const designName = useStore((s) => s.designName);
  const setDesignName = useStore((s) => s.setDesignName);
  const saveCurrentDesign = useStore((s) => s.saveCurrentDesign);
  const newDesign = useStore((s) => s.newDesign);
  const activeDesignId = useStore((s) => s.activeDesignId);
  const dirty = useStore((s) => s.dirty);

  const saved = activeDesignId !== null && !dirty;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <input
        value={designName}
        onChange={(e) => setDesignName(e.target.value)}
        aria-label="Panel name"
        placeholder="Untitled panel"
        className="w-48 min-w-24 shrink rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-[13.5px]
                   outline-none focus:border-accent"
      />
      <Button
        variant="primary"
        onClick={() => saveCurrentDesign()}
        disabled={saved}
        // Three states in one button: the panel has never been saved, it has
        // changes to write, or it is up to date. Disabling the last one makes
        // "Saved" a statement rather than something to keep pressing.
        title={saved ? 'No changes since the last save' : 'Save this panel to the library'}
      >
        {activeDesignId ? (dirty ? 'Save changes' : 'Saved') : 'Save to library'}
      </Button>
      <Button onClick={newDesign} title="Start a new panel">New panel</Button>
    </div>
  );
}
