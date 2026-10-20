// EDIT-037: searching file contents across the worktree, and opening a file at a hit.
import { invoke } from "@tauri-apps/api/core";
import { keyOf } from "./buffers";

/** `text` is cut to about 200 characters for the list; `len` is the hit's full length in UTF-16 units. */
export type Hit = { line: number; col: number; before: string; text: string; after: string; len: number };
export type FileHits = { path: string; hits: Hit[] };
export type Found = { files: FileHits[]; total: number; capped: boolean; source: "rg" | "git" | "none" };
export type Ask = { query: string; matchCase: boolean; wholeWord: boolean; regex: boolean; include: string; exclude: string };

export const searchFiles = (root: string, ask: Ask) => invoke<Found>("editor_search", { root, ask });
/** FIX-4: tells the backend that no view wants the folder's search any more (the view closed). */
export const cancelSearch = (root: string) => invoke<void>("editor_search_cancel", { root });

/** FIX-4 (council d2 AFTER 1, 7): the searches of one explorer view. Only the newest search's answer
 * (or failure) reaches the view; an older one that comes back late is dropped. Closing the view drops
 * what is still out and, if the view ever searched, lets the backend stop that folder's search, so a
 * workspace switch does not leave one running to its cap or its time limit. */
export function searchSession(root: string, call: (root: string, ask: Ask) => Promise<Found> = searchFiles, cancel: (root: string) => unknown = cancelSearch) {
  let n = 0;
  let sent = false;
  let closed = false;
  let asked = 0;
  let out = false; // the newest search has not answered yet
  const stop = () => void Promise.resolve(cancel(root)).catch(() => {});
  return {
    run(ask: Ask, done: (f: Found) => void, failed: (e: unknown) => void) {
      const mine = ++n;
      const latest = ++asked;
      sent = true;
      out = true;
      // FIX-6 (council d2 AFTER 1): the newest search answering clears `out` even when the answer is
      // dropped (the query moved on), so a later empty() does not send a cancel to an idle folder.
      call(root, ask).then(
        (f) => (latest === asked && (out = false), mine === n && !closed && done(f)),
        (e) => (latest === asked && (out = false), mine === n && !closed && failed(e)),
      );
    },
    /** The query changed: an older answer is dropped when it comes. The backend is left alone, because
     * the next search of the folder replaces the running one. */
    drop() {
      n++;
    },
    /** FIX-5 (council d2 AFTER 3): the query was emptied, so no search follows. What is out is dropped
     * and the backend is told to stop it, instead of letting it run on to its cap or its time limit. */
    empty() {
      n++;
      if (out && !closed) {
        out = false;
        stop();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      n++;
      if (sent) stop();
    },
  };
}

/** A result's path (relative, forward slashes) under the worktree, in the worktree's own style. */
export function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
}

/** The line under the query box. */
export function summary(f: Found): string {
  if (!f.total) return "No results.";
  const n = `${f.total} result${f.total === 1 ? "" : "s"} in ${f.files.length} file${f.files.length === 1 ? "" : "s"}`;
  const cut = f.capped ? `. Only the first ${f.total} are shown; narrow the search to see the rest` : "";
  const how = f.source === "git" ? ". ripgrep was not found, so git searched the tracked and untracked files" : "";
  return `${n}${cut}${how}.`;
}

// Opening at a hit: the file's tab may already be open or may still be loading, so the spot waits
// here until that tab takes it. A spot nobody takes within a few seconds is dropped.
export type Spot = { line: number; col: number; len: number };
const waiting = new Map<string, Spot & { at: number }>();
const listeners = new Set<() => void>();
const FRESH_MS = 10_000;

export function revealAt(path: string, spot: Spot) {
  waiting.set(keyOf(path), { ...spot, at: Date.now() });
  listeners.forEach((f) => f());
}

export function hasSpot(path: string): boolean {
  const s = waiting.get(keyOf(path));
  return !!s && Date.now() - s.at < FRESH_MS;
}

export function takeSpot(path: string): Spot | null {
  const fresh = hasSpot(path);
  const s = waiting.get(keyOf(path));
  waiting.delete(keyOf(path));
  return fresh && s ? { line: s.line, col: s.col, len: s.len } : null;
}

export function onReveal(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

type Doc = { lines: number; line(n: number): { from: number; length: number } };

/** Where a spot lands in a document, clamped to it in case the file changed since the search. */
export function spotRange(doc: Doc, s: Spot): { from: number; to: number } {
  const line = doc.line(Math.min(Math.max(1, s.line), doc.lines));
  const from = line.from + Math.min(s.col, line.length);
  return { from, to: Math.min(from + s.len, line.from + line.length) };
}
