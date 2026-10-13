// One text per open file (EDIT-001). Every editor showing the same file is attached to its
// buffer: what is typed in one is copied into the others, so two split panes edit one text; the
// buffer remembers what is on disk, so a tab is unsaved only while its text differs from that by
// more than trailing whitespace; a save writes the file once and leaves every view clean.
import { Annotation, type Transaction, type ChangeSet, type EditorState } from "@codemirror/state";

/** Marks a change Kolux made itself (a copy from the twin view, a reload), not the user's typing. */
export const synced = Annotation.define<boolean>();

/** The part of an editor view a buffer needs; EditorView fits it, and the tests use plain states. */
export type View = { state: EditorState; dispatch: (spec: { changes: ChangeSet | { from: number; to: number; insert: string }; annotations: Annotation<boolean> }) => void };

/** Text equal to the disk copy except for whitespace at the ends of lines (and of the file). */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[ \t]+(?=\r?\n|$)/g, "").replace(/\s+$/, "");
  return a === b || norm(a) === norm(b);
}

/** Reads a file, trying again a few times before giving up with the last error (EDIT-001). */
export async function loadText(read: () => Promise<string>, tries = 3, wait = 300): Promise<string> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await read();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

/** The buffer key: Windows paths compare without case and with either slash. */
export const keyOf = (path: string) => (/^[a-z]:[\\/]/i.test(path) ? path.replace(/\\/g, "/").toLowerCase() : path);
export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

// sliceDoc, not doc.toString(): it joins lines with the file's own line end (CRLF stays CRLF).
type Buffer = { disk: string; views: Set<View>; listeners: Set<() => void> };
const buffers = new Map<string, Buffer>();

function buf(path: string): Buffer {
  const k = keyOf(path);
  let b = buffers.get(k);
  if (!b) buffers.set(k, (b = { disk: "", views: new Set(), listeners: new Set() }));
  return b;
}
const tell = (b: Buffer) => b.listeners.forEach((f) => f());

/** The text a newly attached view should show: a twin's current text, else what was read. */
export function attach(path: string, view: View, disk: string): void {
  const b = buf(path);
  if (b.views.size === 0) b.disk = disk;
  const twin = [...b.views][0];
  b.views.add(view);
  if (twin && twin.state.sliceDoc() !== view.state.sliceDoc()) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: twin.state.sliceDoc() }, annotations: synced.of(true) });
  }
  tell(b);
}

export function detach(path: string, view: View): void {
  const b = buf(path);
  b.views.delete(view);
  if (b.views.size === 0 && b.listeners.size === 0) buffers.delete(keyOf(path));
}

/** Called for each transaction of an attached view: the user's edits go to its twins. */
export function relay(path: string, from: View, tr: Transaction): void {
  if (!tr.docChanged) return;
  const b = buf(path);
  if (!tr.annotation(synced)) for (const v of b.views) if (v !== from) v.dispatch({ changes: tr.changes, annotations: synced.of(true) });
  tell(b);
}

export function isDirty(path: string): boolean {
  const b = buffers.get(keyOf(path));
  const v = b && [...b.views][0];
  return !!v && !sameText(v.state.sliceDoc(), b.disk);
}

/** EDIT-003 (T-073-a): lowercase hex SHA-256 of a text's UTF-8 bytes. file_read returns the file's
 *  bytes unchanged, so this is the hash of the disk copy the buffer holds; file_write's optional
 *  `loaded_hash` is compared with the file's bytes before writing. */
export async function hashOf(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** file_write's typed refusal when the file changed on disk since it was loaded: error kind
 *  `stale`, as an object's `kind` or as the start of the error text. */
export const isStale = (e: unknown): boolean => (typeof e === "object" && e !== null && (e as { kind?: unknown }).kind === "stale") || String(e).startsWith("stale");

/** Writes the file once, from the buffer's text; every view of it is clean afterwards. The write
 *  gets the hash of the disk copy the buffer was loaded from, so a file changed meanwhile is
 *  refused; `force` (Keep mine) leaves the hash out and overwrites. */
export async function save(path: string, write: (text: string, loadedHash?: string) => Promise<void>, force = false): Promise<void> {
  const b = buf(path);
  const v = [...b.views][0];
  if (!v) return;
  const text = v.state.sliceDoc();
  await write(text, force ? undefined : await hashOf(b.disk));
  b.disk = text;
  tell(b);
}

/** Text Kolux puts in itself (a reload): every view shows it and none is unsaved. */
export function replaceAll(path: string, text: string): void {
  const b = buf(path);
  b.disk = text;
  for (const v of b.views) if (v.state.sliceDoc() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, annotations: synced.of(true) });
  tell(b);
}

export function subscribe(path: string, f: () => void): () => void {
  const b = buf(path);
  b.listeners.add(f);
  return () => {
    b.listeners.delete(f);
    if (b.views.size === 0 && b.listeners.size === 0) buffers.delete(keyOf(path));
  };
}

/** The open text of a file, or null when no editor has it open (a preview then reads the disk). */
export function textOf(path: string): string | null {
  const v = buffers.get(keyOf(path))?.views.values().next().value;
  return v ? v.state.sliceDoc() : null;
}
