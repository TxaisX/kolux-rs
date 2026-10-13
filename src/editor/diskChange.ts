// EDIT-003 (T-073): noticing that a file open in an editor tab was changed on disk by someone else
// (an agent, a terminal, another program). The check is cheap and advisory: the file's modified
// time and size (its "stamp", from the file_stamps command) are compared with the stamp of the
// copy the tab last loaded or saved. It only decides whether to show the banner or take the new
// copy quietly; the real guard is the save's hash check (T-073-a), which still refuses a save when
// a same-size rewrite inside one check, or a tool that puts the old modified time back, slips past
// the stamp. One entry per file (buffers.ts keys), so two panes showing one file share it.
import { keyOf } from "./buffers";

/** The file's modified time (ms) and size (bytes), or null when it is gone or cannot be looked at. */
export type Stamp = { mtime: number; size: number };

/** How often the tabs in front are checked, besides a check whenever the window gets focus. */
export const POLL_MS = 2000;
/** How long the "Reloaded from disk" toast with its Undo stays up. */
export const UNDO_TOAST_MS = 10000;

export const sameStamp = (a: Stamp | null, b: Stamp | null): boolean => (a && b ? a.mtime === b.mtime && a.size === b.size : a === b);

/** `known`: the stamp of the copy the buffer holds (loaded, reloaded or saved by Kolux itself).
 *  `kept`: the disk stamp the user answered Keep my edits for, so the banner stays away until the
 *  file changes again. `seq`: counts reads, so a read that finishes after a newer one is dropped.
 *  `banner`: shown now (T-073-d: autosave, once T-177 lands, holds back while this is true). */
type Entry = { known?: Stamp | null; kept?: Stamp | null; seq: number; banner: boolean };
const entries = new Map<string, Entry>();
const entry = (path: string): Entry => {
  const k = keyOf(path);
  let e = entries.get(k);
  if (!e) entries.set(k, (e = { seq: 0, banner: false }));
  return e;
};

/** The buffer now holds the disk copy with this stamp: after a load, a reload or Kolux's own save,
 *  which is why Kolux's saves never raise the banner. Forgets an earlier Keep my edits. */
export function remember(path: string, stamp: Stamp | null): void {
  const e = entry(path);
  e.known = stamp;
  e.kept = undefined;
}

/** Keep my edits: the banner stays away until the disk copy changes from `stamp`. */
export function keep(path: string, stamp: Stamp | null): void {
  entry(path).kept = stamp;
  setBanner(path, false);
}

export function setBanner(path: string, up: boolean): void {
  entry(path).banner = up;
}

/** T-073-d / EDIT-002: autosave asks this and holds back while the banner is up. */
export const bannerUp = (path: string): boolean => entries.get(keyOf(path))?.banner ?? false;

/** Drops what is known about a file once no tab shows it. */
export function forget(path: string): void {
  entries.delete(keyOf(path));
}

export type Verdict = "none" | "reload" | "banner";

/** What a check that read `now` from disk should do for a tab, by the card's rules: nothing when
 *  the stamp is the known one (or the one kept), or the file is gone or not loaded yet; a quiet
 *  reload for a tab without unsaved edits; the banner for one with them. The caller checks only
 *  tabs in front, so a background tab is left alone until it is brought forward. */
export function verdict(path: string, now: Stamp | null, dirty: boolean): Verdict {
  const e = entries.get(keyOf(path));
  if (!e || e.known === undefined || now === null) return "none";
  if (sameStamp(now, e.known)) return "none";
  if (e.kept !== undefined && sameStamp(now, e.kept)) return "none";
  return dirty ? "banner" : "reload";
}

/** Starts a read of the file; any read started before it no longer counts. */
export function beginRead(path: string): number {
  return ++entry(path).seq;
}
/** True while no newer read of the file has been started since `token`. */
export const isLatest = (path: string, token: number): boolean => entries.get(keyOf(path))?.seq === token;

/** A fresh read: the stamp is taken before the text, so a write landing in between shows up as a
 *  new stamp at the next check instead of being missed. Resolves null when a newer read started
 *  meanwhile (that late result is thrown away instead of replacing newer content). Reload always
 *  calls this, so it never reuses a read already under way. */
export async function readFresh(path: string, stampOf: () => Promise<Stamp | null>, read: () => Promise<string>): Promise<{ text: string; stamp: Stamp | null } | null> {
  const token = beginRead(path);
  const stamp = await stampOf();
  const text = await read();
  return isLatest(path, token) ? { text, stamp } : null;
}

/** What the toast's Undo puts back: the text before a Reload. Undo only applies while the buffer
 *  still holds exactly what the Reload brought in; after more typing the editor's own undo history
 *  (Ctrl+Z) still has the Reload as one step. */
export type UndoEntry = { path: string; before: string; after: string };
export const canUndo = (u: UndoEntry | null, current: string | null): boolean => !!u && current === u.after && u.before !== u.after;

/** What a check reads and changes for one tab; EditorPane passes the real file commands and
 *  buffer calls, the tests plain fakes. */
export type Io = { stamp: () => Promise<Stamp | null>; read: () => Promise<string>; dirty: () => boolean; current: () => string | null; apply: (text: string, undoable: boolean) => void };

/** One check of a tab in front (every POLL_MS, on window focus, when the tab comes forward). A
 *  tab without unsaved edits takes the new disk copy quietly; one with edits gets the banner,
 *  reported through `onBanner` with the stamp that raised it (Keep my edits keeps that one). */
export async function checkOnce(path: string, io: Io, onBanner: (now: Stamp | null) => void): Promise<Verdict> {
  const now = await io.stamp();
  const v = verdict(path, now, io.dirty());
  if (v === "reload") {
    const got = await readFresh(path, io.stamp, io.read);
    // Typing that started while the read was out turns this into the banner at the next check.
    if (got && !io.dirty()) {
      io.apply(got.text, false);
      remember(path, got.stamp);
    }
  } else if (v === "banner") {
    setBanner(path, true);
    onBanner(now);
  }
  return v;
}

/** Reload from the banner or the Compare view: always a fresh read, applied as one undoable step;
 *  null when a newer read overtook it. The banner goes down. */
export async function reloadNow(path: string, io: Io): Promise<UndoEntry | null> {
  const got = await readFresh(path, io.stamp, io.read);
  if (!got) return null;
  const before = io.current() ?? "";
  io.apply(got.text, true);
  remember(path, got.stamp);
  setBanner(path, false);
  return { path, before, after: got.text };
}
