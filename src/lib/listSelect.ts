/**
 * Clicking in a list of things, as file lists do.
 *
 * A plain click picks one and marks it as where a range starts. Cmd or Ctrl
 * adds one or takes it back out, and moves that mark. Shift picks everything
 * from the mark to the one clicked, in the list's order; with Cmd as well,
 * that run is added to what was already picked rather than replacing it.
 *
 * Only this list's part of the selection is touched: cutouts picked in their
 * list leave selected labels selected, and the other way round.
 */
export function pickInList(
  list: string[],
  selected: string[],
  anchor: string | null,
  id: string,
  mods: { shift: boolean; toggle: boolean },
): { selection: string[]; anchor: string | null } {
  if (mods.shift) {
    // Without a mark of its own, the run starts from whatever in this list
    // was picked last, on the canvas or here.
    const from = anchor && list.includes(anchor)
      ? anchor
      : [...selected].reverse().find((s) => list.includes(s)) ?? id;
    const a = list.indexOf(from), b = list.indexOf(id);
    const run = list.slice(Math.min(a, b), Math.max(a, b) + 1);
    const elsewhere = selected.filter((s) => !list.includes(s));
    const kept = mods.toggle ? selected.filter((s) => list.includes(s) && !run.includes(s)) : [];
    return { selection: [...elsewhere, ...kept, ...run], anchor: from };
  }
  if (mods.toggle) {
    return {
      selection: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
      anchor: id,
    };
  }
  return { selection: [id], anchor: id };
}
