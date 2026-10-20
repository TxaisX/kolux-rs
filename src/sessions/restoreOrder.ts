// VIEW-107 (T-069-c): restored workspaces rebuild their tab layouts in session order, in one pass.
// A tab's key is handed out in the order tabs were opened, so "session order" is key order. A saved
// layout whose entries are out of order (an older file, a merge of two writes) is put right with one
// stable sort; the tabs of every workspace then come back in the order they were opened, whichever
// workspace they belong to, and the start lines are asked for in that same order. Already in order
// returns the same list, so a normal restore does no extra work.

/** `panes` in session (key) order; the same array when it already is. Equal keys keep their saved order. */
export function sessionOrder<P extends { key: number }>(panes: P[]): P[] {
  if (panes.every((p, i) => i === 0 || panes[i - 1].key <= p.key)) return panes;
  return [...panes].sort((a, b) => a.key - b.key);
}
