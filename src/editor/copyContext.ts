// EDIT-007: a selection copied with its path and line numbers, ready to paste into an agent's prompt.
import type { Text } from "@codemirror/state";

/** What Copy Context puts on the clipboard: `path:line` with nothing selected, bare text for part
 * of one line, otherwise the selected text under a `path:from-to` header. An end in column one of a
 * later line leaves that line out. */
export function contextText(doc: Text, from: number, to: number, path: string): { text: string; header: boolean } {
  if (from === to) return { text: `${path}:${doc.lineAt(from).number}`, header: true };
  const a = doc.lineAt(from);
  let b = doc.lineAt(to);
  if (to === b.from && b.number > a.number) b = doc.line(b.number - 1);
  const end = Math.min(to, b.to);
  const body = doc.sliceString(from, end);
  if (a.number === b.number && !(from === a.from && end === a.to)) return { text: body, header: false };
  return { text: `${path}:${a.number === b.number ? a.number : `${a.number}-${b.number}`}\n${body}`, header: true };
}
