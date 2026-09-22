import type { Rack } from './rack';
import { isSaved, type SavedDesign } from './storage';
import { uid } from './types';

/**
 * Export and import files.
 *
 * Plain JSON with a version stamp, so a file written today can still be opened
 * after the app has moved on, and so it can be read or hand-edited without
 * this app at all. A rack file carries the panels it uses, which makes it
 * self-contained: hand someone a rack and they get the panels with it.
 */

export const FORMAT = 'eurorack-panel-generator';
export const FORMAT_VERSION = 1;

export type BackupKind = 'panel' | 'rack' | 'library';

export interface Backup {
  format: typeof FORMAT;
  version: number;
  kind: BackupKind;
  exportedAt: string;
  panels: SavedDesign[];
  rack?: Rack | null;
}

export function buildPanelBackup(panel: SavedDesign): Backup {
  return base('panel', [panel]);
}

/**
 * A rack, plus every panel it places.
 *
 * Only the panels actually used are included: exporting a rack should not
 * quietly hand over the rest of someone's library.
 */
export function buildRackBackup(rack: Rack, library: SavedDesign[]): Backup {
  const used = new Set(rack.rows.flatMap((r) => r.placements.map((p) => p.designId)));
  return { ...base('rack', library.filter((d) => used.has(d.id))), rack };
}

export function buildLibraryBackup(library: SavedDesign[], rack: Rack): Backup {
  return { ...base('library', library), rack };
}

function base(kind: BackupKind, panels: SavedDesign[]): Backup {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    kind,
    exportedAt: new Date().toISOString(),
    panels,
  };
}

export interface ParseResult {
  backup: Backup;
  /** Entries that were dropped because they did not look like panels. */
  skipped: number;
}

/**
 * Read a file back.
 *
 * Deliberately forgiving about everything except the shape of a panel: a file
 * written by a later version may carry fields this one does not know, and
 * those should be ignored rather than treated as corruption.
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  if (!raw || typeof raw !== 'object') throw new Error('That file is not a panel export.');
  const b = raw as Partial<Backup>;
  if (b.format !== FORMAT) {
    throw new Error('That file was not written by this app.');
  }
  if (typeof b.version !== 'number' || b.version > FORMAT_VERSION) {
    throw new Error(`That file needs a newer version of the app (format ${String(b.version)}).`);
  }

  const all = Array.isArray(b.panels) ? b.panels : [];
  const panels = all.filter(isSaved);
  const rack = b.rack && Array.isArray((b.rack as Rack).rows) ? (b.rack as Rack) : null;

  if (panels.length === 0 && !rack) throw new Error('That file has no panels or rack in it.');

  return {
    backup: {
      format: FORMAT,
      version: b.version,
      kind: (b.kind as BackupKind) ?? 'library',
      exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
      panels,
      rack,
    },
    skipped: all.length - panels.length,
  };
}

export interface MergeReport {
  added: number;
  updated: number;
  unchanged: number;
  rackReplaced: boolean;
}

export interface MergeResult {
  library: SavedDesign[];
  rack: Rack | null;
  report: MergeReport;
}

/**
 * Fold an imported file into what is already here.
 *
 * Matching is by id, and the newer `updatedAt` wins, so re-importing a backup
 * restores rather than duplicates. Panels made elsewhere have different ids and
 * simply arrive alongside. Nothing is ever deleted by an import: a file that
 * omits a panel is not a statement that the panel should go.
 */
export function mergeBackup(
  library: SavedDesign[],
  backup: Backup,
  opts: { replaceRack: boolean },
): MergeResult {
  const byId = new Map(library.map((d) => [d.id, d]));
  const report: MergeReport = { added: 0, updated: 0, unchanged: 0, rackReplaced: false };

  for (const incoming of backup.panels) {
    const existing = byId.get(incoming.id);
    if (!existing) {
      byId.set(incoming.id, incoming);
      report.added++;
    } else if (incoming.updatedAt > existing.updatedAt) {
      byId.set(incoming.id, incoming);
      report.updated++;
    } else {
      report.unchanged++;
    }
  }

  let rack: Rack | null = null;
  if (backup.rack && opts.replaceRack) {
    // Drop placements whose panel is not present, or the rack would show gaps
    // that cannot be filled or edited.
    const have = new Set([...byId.keys()]);
    rack = {
      ...backup.rack,
      updatedAt: Date.now(),
      rows: backup.rack.rows.map((r) => ({
        ...r,
        placements: r.placements.filter((p) => have.has(p.designId)),
      })),
    };
    report.rackReplaced = true;
  }

  return {
    library: [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    rack,
    report,
  };
}

/**
 * Copy panels under fresh ids.
 *
 * For importing a file alongside your own work rather than over it — handy
 * when someone sends you a rack and you want it without touching the panels
 * you already have.
 */
export function withNewIds(backup: Backup): Backup {
  const remap = new Map(backup.panels.map((p) => [p.id, uid('d')]));
  return {
    ...backup,
    panels: backup.panels.map((p) => ({ ...p, id: remap.get(p.id)! })),
    rack: backup.rack
      ? {
          ...backup.rack,
          rows: backup.rack.rows.map((r) => ({
            ...r,
            placements: r.placements
              .filter((p) => remap.has(p.designId))
              .map((p) => ({ ...p, id: uid('p'), designId: remap.get(p.designId)! })),
          })),
        }
      : backup.rack,
  };
}

/** A filename that sorts by date and survives a filesystem. */
export function backupFilename(kind: BackupKind, name?: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (name ?? kind).toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${slug || kind}-${stamp}.${kind}.json`;
}
