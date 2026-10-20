// GIT-040 / GIT-041: review notes on diff lines. A note sits under a line of the file's new side,
// is kept per workspace in settings, and all of a workspace's notes go to its agent as one message.
import { keyOf } from "./buffers";

/** `end` is the last line when the note covers several; the card hangs under it. `side` is "old" for a
 * note on the left side of a side-by-side diff (the file before the change); no side means the new side. */
export type LineNote = { id: string; path: string; line: number; end?: number; text: string; staged: boolean; sent?: boolean; side?: "old" };
export type Side = "new" | "old";
export const sideOf = (n: LineNote): Side => (n.side === "old" ? "old" : "new");
/** The notes that belong to one side of the diff. */
export const notesOn = (notes: LineNote[], side: Side) => notes.filter((n) => sideOf(n) === side);
/** Where a note sits, as a card or a message says it. */
export const where = (n: LineNote) => `${n.end && n.end !== n.line ? `lines ${n.line}-${n.end}` : `line ${n.line}`}${n.side === "old" ? " (old side)" : ""}`;
/** The short line label in Source Control's list. */
export const lineLabel = (n: LineNote) => `${n.side === "old" ? "old " : ""}${n.end && n.end !== n.line ? `${n.line}-${n.end}` : n.line}`;
/** Settings key: workspace (keyOf its folder) -> its notes. */
export const LINE_NOTES_KEY = "reviewNotes";
type Book = Record<string, LineNote[]>;

const slash = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");

export function lineNotesOf(book: unknown, dir: string | null): LineNote[] {
  if (dir === null || !book || typeof book !== "object") return [];
  const ns = (book as Book)[keyOf(slash(dir))];
  return Array.isArray(ns) ? ns : [];
}

export function withLineNotes(book: unknown, dir: string, notes: LineNote[]): Book {
  const next: Book = { ...(book && typeof book === "object" ? (book as Book) : {}) };
  if (notes.length) next[keyOf(slash(dir))] = notes;
  else delete next[keyOf(slash(dir))];
  return next;
}

/** The text an edit saves: trimmed, or null when nothing is left (an empty edit is refused). */
export const editedText = (text: string) => text.trim() || null;

const byLine = (a: LineNote, b: LineNote) => (a.path === b.path ? a.line - b.line || Number(sideOf(a) === "old") - Number(sideOf(b) === "old") : a.path.localeCompare(b.path));

/** Notes per file, files by name, each file's notes by line. */
export function notesByFile(notes: LineNote[]): [string, LineNote[]][] {
  const out = new Map<string, LineNote[]>();
  for (const n of [...notes].sort(byLine)) out.set(n.path, [...(out.get(n.path) ?? []), n]);
  return [...out];
}

/** The path shown for a note: inside the workspace, relative to it. */
export function shortPath(path: string, root: string | null): string {
  const p = slash(path);
  const r = root === null ? "" : slash(root);
  return r && p.toLowerCase().startsWith(r.toLowerCase() + "/") ? p.slice(r.length + 1) : p;
}

/** The message sent to the agent: one short block per note, a blank line between them. */
export const noteBlocks = (notes: LineNote[], root: string | null) => [...notes].sort(byLine).map((n) => `${shortPath(n.path, root)}, ${where(n)}\n${n.text}`).join("\n\n");

/** After a send: a note is marked sent only if it still says what was sent. */
export const markSent = (now: LineNote[], sent: LineNote[]) => now.map((n) => (sent.some((s) => s.id === n.id && s.text === n.text) ? { ...n, sent: true } : n));

export const clearDelivered = (notes: LineNote[]) => notes.filter((n) => !n.sent);
