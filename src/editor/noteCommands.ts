// GIT-040 / GIT-041: Add Review Note and Send Notes as commands. Both are in the shortcut table
// (src/keys/actions.ts) under fixed ids, so the Shortcuts list shows them and a user's own chord is
// the one that works; nothing here hard-codes a key. Add Review Note ships on Mod+Shift+A, Send
// Notes ships unbound.
import { actionById } from "../keys/actions";
import { matchEvent, type KeyLike, type Keymap } from "../keys/keymap";

export const ADD_NOTE = "editor.addReviewNote";
export const SEND_NOTES = "sourceControl.sendReviewNotes";
export type NoteCommand = "add" | "send";

/** Which of the two note commands a key press is, under the user's keymap; null for anything else. */
export function noteCommand(map: Keymap, e: KeyLike): NoteCommand | null {
  const hit = matchEvent(map, e, ["editor"]);
  return hit?.id === ADD_NOTE ? "add" : hit?.id === SEND_NOTES ? "send" : null;
}

/** Both commands are registered; the title and default chord come from the one table. */
export const noteCommandInfo = (which: NoteCommand) => actionById.get(which === "add" ? ADD_NOTE : SEND_NOTES);

/** What Send Notes does: open the Send menu for the Markdown notes, paste the workspace's line notes
 * into its agent, or say there is nothing to send. Markdown notes win because they only leave the
 * window through that menu. */
export type SendRoute = "menu" | "lines" | "none";
export function sendRoute(reviewOn: boolean, markdownNotes: number, lineNotes: number): SendRoute {
  if (!reviewOn) return "none";
  if (markdownNotes > 0) return "menu";
  return lineNotes > 0 ? "lines" : "none";
}

export const NOTHING_TO_SEND = "There are no review notes to send. Select lines in a file and add one first.";
