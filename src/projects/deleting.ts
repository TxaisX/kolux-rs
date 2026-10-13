// PROJ-070: deleting a workspace safely. What the backend found, what the question shows, and
// whether the question can be skipped.

/** What `workspace_remove_check` returns. */
export type RemoveCheck = { changes: string[]; locked: string | null; nested: string[]; stamp: string; gone?: boolean };

/** PROJ-072: the toast when terminals still run in the folder, naming them. */
export function runningSentence(names: string[]): string | null {
  if (names.length === 0) return null;
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `${list} ${names.length === 1 ? "is" : "are"} still running in this folder. Force delete ends ${names.length === 1 ? "it" : "them"} and deletes the workspace.`;
}

/** Settings field: false skips the question for one clean workspace. */
export const CONFIRM_DELETE_FIELD = "confirmWorkspaceDelete";

export const asksBeforeDelete = (settings: Record<string, unknown>) => settings[CONFIRM_DELETE_FIELD] !== false;

/** Why the delete cannot happen at all (forcing does not help), or null. */
export function blocker(c: RemoveCheck): string | null {
  if (c.nested.length > 0) return `This folder holds another workspace (${c.nested[0]}). Delete that one first.`;
  if (c.locked !== null) return `This workspace is locked${c.locked ? ` (${c.locked})` : ""}. Kolux never force-deletes a locked workspace; unlock it with git worktree unlock first.`;
  return null;
}

export const isClean = (c: RemoveCheck) => c.changes.length === 0 && blocker(c) === null;

/** The question goes straight to deleting only for a clean workspace with the setting off. */
export const skipsQuestion = (c: RemoveCheck, settings: Record<string, unknown>) => isClean(c) && !asksBeforeDelete(settings);

/** The first `max` change lines, and how many more there are. */
export function shownChanges(c: RemoveCheck, max = 5): { lines: string[]; more: number } {
  return { lines: c.changes.slice(0, max), more: Math.max(0, c.changes.length - max) };
}

/** VIEW-048: the workspace the delete shortcut acts on; the row under the pointer wins over the one shown. */
export const deleteTarget = (hovered: string | null, active: string | null) => hovered ?? active;
