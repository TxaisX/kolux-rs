// EDIT-007 in All Changes (EDIT-029): Copy Context copies the selection of the diff view the user last
// focused, headed by that file's path and lines (the old side's lines are marked as "before the change").
import type { Text } from "@codemirror/state";
import { contextText, oldSideContext } from "./copyContext";
import { shortPath } from "./diffNotes";

export type CopyView = { state: { doc: Text; selection: { main: { from: number; to: number } } } };
/** The view the user last put the cursor in: its file, whether it is the old (left) side, and the view. */
export type LastFocus = { path: string; old: boolean; view: CopyView };

/** What goes on the clipboard, or null when no diff view was ever focused. */
export function allChangesContext(last: LastFocus | null, root: string): string | null {
  if (!last) return null;
  const { from, to } = last.view.state.selection.main;
  const got = contextText(last.view.state.doc, from, to, shortPath(last.path, root));
  return last.old ? oldSideContext(got) : got.text;
}
