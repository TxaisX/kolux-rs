// One text per open file (EDIT-001). Every editor showing the same file is attached to its
// buffer: what is typed in one is copied into the others, so two split panes edit one text; the
// buffer remembers what is on disk, so a tab is unsaved only while its text differs from that by
// more than trailing whitespace; a save writes the file once and leaves every view clean.
//
// The first frame loads this module (FloatingLayer asks isDirty, the window asks keyOf and
// baseName), so it carries no CodeMirror: the five values it cannot make itself — the annotation
// that marks Kolux's own change and the read of it, the undo grouping a reload gets, the line
// separator of a view, and the text split into lines — are installed by editor/editors.ts, the
// CodeMirror side, which loads with the editor.
import type { Annotation, ChangeSet, EditorState, StateEffect, Text, Transaction } from "@codemirror/state";

/** What the CodeMirror side gives the store; editor/editors.ts builds it from @codemirror/state and
 *  @codemirror/commands and installs it before any view is attached. */
type CodeMirror = {
  /** marks a change Kolux made itself (a copy from the twin view, a reload) */
  mark: () => Annotation<boolean>;
  /** whether a transaction carries that mark */
  marked: (tr: Transaction) => boolean;
  /** makes the transaction one undo step of its own, apart from the typing before it */
  isolate: () => Annotation<unknown>;
  /** the effect that switches a view's line separator */
  ends: (end: string) => StateEffect<unknown>;
  /** text already split into lines, as a view splits them */
  lines: (text: string, end: string) => Text;
};

let codeMirror: CodeMirror | null = null;

/** Installs the CodeMirror values, once, as editor/editors.ts loads (it is the module the editor and
 *  the buffers' own tests import; nothing on the first frame calls a view's dispatch). */
export function useCodeMirror(cm: CodeMirror): void {
  codeMirror = cm;
}

function cm(): CodeMirror {
  if (!codeMirror) throw new Error("editor/buffers: the CodeMirror side is not loaded (import editor/editors before attaching a view)");
  return codeMirror;
}

// A file with Windows line ends is shown and saved with them. T-603: the separator sits in a
// compartment (editor/editors.ts) that a reload using other line ends throughout switches
// (replaceAll), and text the rich view or the notebook view hands the editor gets the editor's own
// line breaks (withLineBreaks).
/** T-603: the one line end `text` uses throughout, or null when it has none or mixes CRLF with bare LF. */
const soleLineEnd = (text: string): string | null => {
  const crlf = text.includes("\r\n");
  return crlf === /(^|[^\r])\n/.test(text) ? null : crlf ? "\r\n" : "\n";
};

/** The part of an editor view a buffer needs; EditorView fits it, and the tests use plain states. */
export type View = { state: EditorState; dispatch: (spec: { changes: ChangeSet | { from: number; to: number; insert: string | Text }; effects?: StateEffect<unknown> | readonly StateEffect<unknown>[]; annotations: Annotation<unknown> | readonly Annotation<unknown>[] }) => void };

/** Text equal to the disk copy except for whitespace at the ends of lines (and of the file). */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[ \t]+(?=\r?\n|$)/g, "").replace(/\s+$/, "");
  return a === b || norm(a) === norm(b);
}

/** EDIT-046: the refusals a retry cannot change (the file is binary, over the size bound, or not UTF-8). */
export const NOT_TEXT = /is a binary file|is too large to open|is not UTF-8 text/;

/** Reads a file, trying again a few times before giving up with the last error (EDIT-001). A file
 *  that is not text (EDIT-046) is given up on at once: reading it again changes nothing. */
export async function loadText(read: () => Promise<string>, tries = 3, wait = 300): Promise<string> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await read();
    } catch (e) {
      last = e;
      if (NOT_TEXT.test(String(e))) break;
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

/** The text a newly attached view should show: a twin's current text, else what was read. T-603: the twin's lines and
 *  separator too, as a change relayed between views that split the text differently does not fit (a twin that kept LF
 *  through a mixed reload, while the at-open rule gives the mixed file CRLF). */
export function attach(path: string, view: View, disk: string): void {
  const b = buf(path);
  if (b.views.size === 0) b.disk = disk;
  const twin = [...b.views][0];
  b.views.add(view);
  if (twin && (twin.state.lineBreak !== view.state.lineBreak || twin.state.sliceDoc() !== view.state.sliceDoc())) {
    const end = twin.state.lineBreak;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: twin.state.doc }, effects: view.state.lineBreak === end ? [] : cm().ends(end), annotations: cm().mark() });
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
  if (!cm().marked(tr)) for (const v of b.views) if (v !== from) v.dispatch({ changes: tr.changes, annotations: cm().mark() });
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
export async function save(path: string, write: (text: string, loadedHash?: string) => Promise<unknown>, force = false): Promise<void> {
  const b = buf(path);
  const v = [...b.views][0];
  if (!v) return;
  const text = v.state.sliceDoc();
  await write(text, force ? undefined : await hashOf(b.disk));
  b.disk = text;
  tell(b);
}

/** Text Kolux puts in itself (a reload): every view shows it and none is unsaved. `undoable`
 *  (EDIT-003's Reload) makes it one step of its own in each view's undo history, so Ctrl+Z or the
 *  toast's Undo brings the edits back. T-603 (F01-editor.4): text that uses one line end throughout,
 *  other than the view's, switches the view's separator; text that mixes CRLF with bare LF, or has no
 *  line end, keeps the view's own (switching would merge each line of the other kind into its
 *  neighbour). It goes in already split into lines (the transaction splits a string on the separator
 *  it starts with). */
export function replaceAll(path: string, text: string, undoable = false): void {
  const b = buf(path);
  b.disk = text;
  const annotations = undoable ? [cm().mark(), cm().isolate()] : cm().mark();
  const sole = soleLineEnd(text);
  for (const v of b.views) {
    if (v.state.sliceDoc() === text) continue;
    const end = sole ?? v.state.lineBreak;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: cm().lines(text, end) }, effects: v.state.lineBreak === end ? [] : cm().ends(end), annotations });
  }
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

/** The text of the open file and the disk copy it was typed over, for the drafts (EDIT-004). */
export function diskOf(path: string): string | null {
  const b = buffers.get(keyOf(path));
  return b && b.views.size ? b.disk : null;
}

// EDIT-032: unsaved text that follows a renamed or moved file. The tab at the new path starts from
// the disk copy it reads, then takes what was carried so the edits stay and the tab stays unsaved.
const carried = new Map<string, { text: string; disk: string }>();

/** Carries the unsaved text of every open file the moves touch (a folder move takes what is under
 *  it) to the new path. Returns the new paths' keys. A clean file carries nothing: its tab reads
 *  the disk at the new place. */
export function carryOver(moves: [string, string][]): string[] {
  const made: string[] = [];
  for (const [k, b] of buffers) {
    const v = [...b.views][0];
    if (!v || sameText(v.state.sliceDoc(), b.disk)) continue;
    for (const [from, to] of moves) {
      const f = keyOf(from);
      if (k !== f && !k.startsWith(f + "/")) continue;
      const nk = keyOf(to) + k.slice(f.length);
      carried.set(nk, { text: v.state.sliceDoc(), disk: b.disk });
      made.push(nk);
      break;
    }
  }
  return made;
}

/** The text carried to this path, once. */
export function takeCarried(path: string): { text: string; disk: string } | null {
  const k = keyOf(path);
  const c = carried.get(k) ?? null;
  carried.delete(k);
  return c;
}

/** Unsaved text a view held when it was torn down to be built again (a diff tab changing its
 *  layout), with the disk copy it was typed over. */
export type Held = { path: string; text: string; disk: string };

/** The unsaved text of an open file and its disk copy, or null when it is clean or not open. */
export function heldOf(path: string): Held | null {
  const b = buffers.get(keyOf(path));
  const v = b && [...b.views][0];
  if (!b || !v || sameText(v.state.sliceDoc(), b.disk)) return null;
  return { path, text: v.state.sliceDoc(), disk: b.disk };
}

/** How a view opening `path` starts. `text` is what it shows; `base` is the disk copy the buffer
 *  takes for it, so a save is checked against the copy that text was typed over, never against a
 *  newer one; `keep` is set when carried unsaved text was typed over a copy that is no longer the
 *  one on disk: the caller keeps it beside the file (unsavedCopy.ts) instead of saving it over. */
export type Opening = { text: string; base: string; keep?: string };

/** The start of a view of `path` read as `disk` (EDIT-001, EDIT-032): a twin's text when another
 *  view has the file open; else unsaved text held across a rebuild; else text carried by a move,
 *  used only when the disk at the new place is the very copy it was typed over. The carry is
 *  taken (once) in every case, so it can never surface later over a newer disk copy. */
export function opening(path: string, disk: string, held?: Held | null): Opening {
  const carry = takeCarried(path);
  const twin = textOf(path);
  if (twin !== null) return { text: twin, base: disk };
  if (held && keyOf(held.path) === keyOf(path)) return { text: held.text, base: held.disk };
  if (!carry) return { text: disk, base: disk };
  if (carry.disk === disk) return { text: carry.text, base: disk };
  return { text: carry.text, base: carry.disk, keep: carry.text };
}
