// PROJ-058: Ctrl-click (Cmd-click on a Mac) toggles a row in the selection and leaves the rest as
// it was; a plain click replaces the selection with that row. Delete asks once for all of them.

import { blocker, isClean, shownChanges, type RemoveCheck } from "./deleting";

/** True for the modifier that means "add to the selection" on this platform. */
export const isToggleClick = (e: { ctrlKey: boolean; metaKey: boolean }, mac: boolean): boolean => (mac ? e.metaKey : e.ctrlKey);

/** The selection after a click on `path`. Paths compare with `same`. */
export function clickRow(selected: string[], path: string, toggle: boolean, same: (a: string, b: string) => boolean): string[] {
  if (!toggle) return [path];
  return selected.some((s) => same(s, path)) ? selected.filter((s) => !same(s, path)) : [...selected, path];
}

/** One selected workspace. Rows are told apart by `path`: two workspaces may share a name (a creature name in
 *  two projects, two folders called "app"), so nothing below is keyed by `name`, which is only for showing. */
export type Checked = { path: string; name: string; check: RemoveCheck };

export type BatchQuestion = {
  title: string;
  /** Workspaces that cannot be removed now, with why. */
  blocked: { path: string; name: string; why: string }[];
  /** Workspaces with changes that would be lost. */
  dirty: { path: string; name: string; lines: string[]; more: number }[];
  /** The paths of everything that will go if the user agrees. */
  removable: string[];
};

/** One question for the whole selection (a single confirmation covers every row). */
export function batchQuestion(items: Checked[]): BatchQuestion {
  const blocked = items.flatMap((i) => {
    const why = blocker(i.check);
    return why === null ? [] : [{ path: i.path, name: i.name, why }];
  });
  const stuck = new Set(blocked.map((b) => b.path));
  const rest = items.filter((i) => !stuck.has(i.path));
  const dirty = rest.filter((i) => !isClean(i.check)).map((i) => ({ path: i.path, name: i.name, ...shownChanges(i.check) }));
  const title = rest.length === 1 ? `Remove ${rest[0].name}?` : `Remove ${rest.length} workspaces?`;
  return { title, blocked, dirty, removable: rest.map((i) => i.path) };
}

/** Rows that stay selected after a delete: the ones that could not be removed. Paths compare with `same`. */
export const selectionAfterDelete = (q: BatchQuestion, all: string[], same: (a: string, b: string) => boolean = (a, b) => a === b): string[] => all.filter((p) => q.blocked.some((b) => same(b.path, p)));
