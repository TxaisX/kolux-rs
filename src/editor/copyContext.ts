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

/** The source lines a rich-view selection covers, or null when it cannot be placed. The rich view
 * drops markup, so the first and last non-empty selected lines are looked for in the note's text;
 * the last is searched from the first. `whole` says the selection is one whole source line (apart
 * from list, quote and heading marks). */
export function quoteLines(text: string, selected: string): { from: number; to: number; whole: boolean } | null {
  const rows = selected.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (rows.length === 0) return null;
  const lines = text.split(/\r?\n/);
  const find = (needle: string, start: number) => {
    for (let i = start; i < lines.length; i++) if (lines[i].includes(needle)) return i;
    return -1;
  };
  const a = find(rows[0], 0);
  if (a < 0) return null;
  const z = rows.length === 1 ? a : find(rows[rows.length - 1], a);
  if (z < 0) return null;
  const rest = lines[a].trim();
  const at = rest.indexOf(rows[0]);
  const marks = /^[#>*+\-\s\d.[\]xX]*$/;
  const whole = rows.length === 1 && at >= 0 && marks.test(rest.slice(0, at)) && rest.slice(at + rows[0].length).trim() === "";
  return { from: a + 1, to: z + 1, whole };
}

/** EDIT-007 in the rich view: the same copy as `contextText`, from the rendered selection. Part of
 * one line is bare text; a whole line or several lines get the `path:from-to` header; null when
 * nothing is selected or the selection cannot be placed in the note, so the key passes through. */
export function richContext(text: string, selected: string, path: string): { text: string; header: boolean } | null {
  const body = selected.trim();
  const r = body ? quoteLines(text, body) : null;
  if (!r) return null;
  if (r.from === r.to && !r.whole) return { text: body, header: false };
  return { text: `${path}:${r.from === r.to ? r.from : `${r.from}-${r.to}`}\n${body}`, header: true };
}

/** EDIT-007 in a diff: a copy made on the old (left) side names its lines as the file had them
 * before the change, so the header is marked and cannot be mistaken for the new file's lines. */
export function oldSideContext(c: { text: string; header: boolean }): string {
  return c.header ? c.text.replace(/^[^\n]*/, (h) => `${h} (before the change)`) : c.text;
}
