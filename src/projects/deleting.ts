// PROJ-070: deleting a workspace safely. What the backend found, what the question shows, and
// whether the question can be skipped.

/** What `workspace_remove_check` returns. */
export type RemoveCheck = { changes: string[]; locked: string | null; nested: string[]; stamp: string; missing?: boolean };

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

/** PROJ-075: the row the delete shortcut found under the pointer, as the sidebar knows it. */
export type PointerRow = { path: string; isMain: boolean; head: string };

/**
 * PROJ-075: what the delete shortcut does to the row under the pointer (the most deeply nested
 * one): a Git worktree starts its delete (the usual question), a folder workspace (a row that is
 * not a Git worktree: no commit) is taken out of Kolux with its folder left on disk. Nothing
 * happens on a main checkout, on a row already being deleted, or while a text field has focus.
 */
export function pointerDelete(row: PointerRow | null, opts: { fieldFocused: boolean; deleting: ReadonlySet<string> }): { action: "delete" | "forget"; path: string } | null {
  if (row === null || opts.fieldFocused || row.isMain) return null;
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const k = norm(row.path);
  if ([...opts.deleting].some((d) => norm(d) === k)) return null;
  return { action: row.head === "" ? "forget" : "delete", path: row.path };
}

/** PROJ-075: a text field (input, text area, editable element) has the focus, so typing Delete edits text. */
export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(((el as HTMLInputElement).type || "text").toLowerCase());
  return (el as HTMLElement).isContentEditable === true || el.getAttribute("contenteditable") === "true";
}
