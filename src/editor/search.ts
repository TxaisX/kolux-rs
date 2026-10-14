// EDIT-037: searching file contents across the worktree, and opening a file at a hit.
import { invoke } from "@tauri-apps/api/core";
import { keyOf } from "./buffers";

export type Hit = { line: number; col: number; before: string; text: string; after: string };
export type FileHits = { path: string; hits: Hit[] };
export type Found = { files: FileHits[]; total: number; capped: boolean; source: "rg" | "git" | "none" };
export type Ask = { query: string; matchCase: boolean; wholeWord: boolean; regex: boolean; include: string; exclude: string };

export const searchFiles = (root: string, ask: Ask) => invoke<Found>("editor_search", { root, ask });

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
