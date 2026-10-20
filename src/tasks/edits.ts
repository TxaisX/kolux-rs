// T-281-b (GIT-048): edits made in Tasks that show at once and do not flip back. An edit is kept beside
// the list as an overlay on the rows GitHub's search returned: a late search answer that still carries the
// old value cannot undo it, and two quick assignee edits are kept as additions and removals (not as a
// whole new list), so both stick. An edit is dropped when GitHub's answer agrees with it, when the user
// refreshes by hand (GitHub's current state again), or after EDIT_TTL_MS. Pure, tested on its own.
import type { Task, TaskLabel } from "./model";

// T-281 (GIT-048): labels too; `tag` is labels added (with their colour, to draw them at once), `untag` names removed.
export type Edit = { state?: string; add: string[]; remove: string[]; tag?: TaskLabel[]; untag?: string[]; at: number };
export type Edits = Record<string, Edit>;

/** How long an edit outlives its confirmation: GitHub's search index lags a few minutes at worst. */
export const EDIT_TTL_MS = 5 * 60_000;

const without = (list: string[], names: string[]) => list.filter((x) => !names.includes(x));
const plus = (list: string[], names: string[]) => [...list, ...names.filter((x) => !list.includes(x))];
const blank = (now: number): Edit => ({ add: [], remove: [], at: now });

/** Assignees added and removed are merged into what is pending for this item: asking for the opposite of a pending edit cancels it. */
export function editAssign(e: Edits, url: string, add: string[], remove: string[], now: number): Edits {
  const cur = e[url] ?? blank(now);
  return { ...e, [url]: { ...cur, add: plus(without(cur.add, remove), add), remove: plus(without(cur.remove, add), remove), at: now } };
}

/** A failed assignee write: its additions and removals leave the pending edit, nothing else does. */
export function undoAssign(e: Edits, url: string, add: string[], remove: string[]): Edits {
  const cur = e[url];
  if (!cur) return e;
  return { ...e, [url]: { ...cur, add: without(cur.add, add), remove: without(cur.remove, remove) } };
}

export function editState(e: Edits, url: string, state: string, now: number): Edits {
  return { ...e, [url]: { ...(e[url] ?? blank(now)), state, at: now } };
}

export function undoState(e: Edits, url: string): Edits {
  const cur = e[url];
  if (!cur || cur.state === undefined) return e;
  const { state: _gone, ...rest } = cur;
  return { ...e, [url]: rest };
}

/** Labels added and removed are merged into what is pending for this item, like assignees. */
export function editLabels(e: Edits, url: string, add: TaskLabel[], remove: string[], now: number): Edits {
  const cur = e[url] ?? blank(now);
  const names = add.map((l) => l.name);
  const tag = [...(cur.tag ?? []).filter((l) => !remove.includes(l.name) && !names.includes(l.name)), ...add];
  return { ...e, [url]: { ...cur, tag, untag: plus(without(cur.untag ?? [], names), remove), at: now } };
}

/** A failed label write: only its own additions and removals leave the pending edit. */
export function undoLabels(e: Edits, url: string, add: string[], remove: string[]): Edits {
  const cur = e[url];
  if (!cur) return e;
  return { ...e, [url]: { ...cur, tag: (cur.tag ?? []).filter((l) => !add.includes(l.name)), untag: without(cur.untag ?? [], remove) } };
}

/** A label list with an item's pending edit applied. */
export function withLabels(base: TaskLabel[], ed: Edit | undefined): TaskLabel[] {
  if (!ed) return base;
  const kept = base.filter((l) => !(ed.untag ?? []).includes(l.name));
  return [...kept, ...(ed.tag ?? []).filter((l) => !kept.some((k) => k.name === l.name))];
}

/** An assignee list with an item's pending edit applied. */
export function withAssignees(base: string[], ed: Edit | undefined): string[] {
  return ed ? plus(without(base, ed.remove), ed.add) : base;
}

/** The rows with every pending edit laid over them. */
export function applyEdits(items: Task[], e: Edits): Task[] {
  return items.map((t) => {
    const ed = e[t.url];
    return ed ? { ...t, state: ed.state ?? t.state, assignees: withAssignees(t.assignees, ed), labels: withLabels(t.labels, ed) } : t;
  });
}

type Row = Pick<Task, "url" | "state" | "assignees"> & { labels?: TaskLabel[] };

const has = (t: Row, name: string) => (t.labels ?? []).some((l) => l.name === name);

const agrees = (t: Row, ed: Edit) =>
  (ed.state === undefined || t.state === ed.state) &&
  ed.add.every((x) => t.assignees.includes(x)) &&
  ed.remove.every((x) => !t.assignees.includes(x)) &&
  (ed.tag ?? []).every((l) => has(t, l.name)) &&
  (ed.untag ?? []).every((n) => !has(t, n));

const empty = (ed: Edit) => ed.state === undefined && ed.add.length === 0 && ed.remove.length === 0 && !ed.tag?.length && !ed.untag?.length;

/** Drops the edits GitHub's rows already show, the empty ones and the ones past their time. Rows GitHub no longer returns (the item left the filter) keep their edit until it expires. */
export function settle(e: Edits, items: Row[], now: number): Edits {
  const out: Edits = {};
  for (const [url, ed] of Object.entries(e)) {
    const row = items.find((t) => t.url === url);
    if (empty(ed) || now - ed.at > EDIT_TTL_MS || (row && agrees(row, ed))) continue;
    out[url] = ed;
  }
  return out;
}

/** The state a list shows (is:open, is:closed...), from the preset and the typed words, or null when it names none. */
export function wantedState(words: string[]): string | null {
  for (const w of words) {
    const m = /^(?:is|state):(open|closed|merged)$/i.exec(w);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** An item whose state no longer matches the list's state filter: it fades out until the next refresh drops it. */
export function leavesFilter(t: Pick<Task, "state">, want: string | null): boolean {
  if (want === null) return false;
  // GitHub counts a merged pull request as closed
  return want === "closed" ? t.state === "open" : t.state !== want;
}
