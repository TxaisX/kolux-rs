// GIT-001 (T-033-b): the git status watcher, front end. The back end keeps one watch per
// worktree (scm_watch); it reads the status after a change has settled, every 30 s as a safety
// net, or every 4 s for a worktree it cannot watch, and sends it as `scm-status-<id>`. Source
// Control, the diff tab and All Changes subscribe here instead of polling. FIX-1 (T-033-e
// review): a watch that ended on its own (its folder went, or a workspace removal that then
// failed) says so as `scm-watch-ended-<id>`, and the page watches again instead of going silent.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Status } from "./model";

export type WatchStart = { id: number; worktree: string; watching: boolean };

/** The same folder spelled with either slash or letter case is one worktree. */
const sameWorktree = (a: string, b: string) => fold(a) === fold(b);
const fold = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Calls `onStatus` with the fresh status of the worktree holding `path` (a folder or a file in
 *  it) whenever git state there moves. Returns the unsubscribe; safe to call before the watch
 *  has started. A path outside any Git worktree simply never calls back. */
export function watchStatus(path: string, onStatus: (s: Status) => void): () => void {
  let done = false;
  let id: number | null = null;
  let worktree: string | null = null;
  let off: (() => void) | null = null;
  const start = () =>
    void invoke<WatchStart>("scm_watch", { path })
      .then(async (w) => {
        if (done) return void invoke("scm_unwatch", { id: w.id });
        // Watching again after the folder went: git can only answer from the nearest folder that
        // exists, which may be another worktree's (the project around a removed workspace). That
        // watch is somebody else's: let it go at once and stay quiet.
        if (worktree !== null && !sameWorktree(worktree, w.worktree)) return void invoke("scm_unwatch", { id: w.id });
        id = w.id;
        worktree = w.worktree;
        const unStatus = await listen<Status>(`scm-status-${w.id}`, (e) => !done && onStatus(e.payload));
        const unEnded = await listen(`scm-watch-ended-${w.id}`, () => {
          if (done || id !== w.id) return;
          off?.();
          off = null;
          id = null; // the back end has let this id go already: nothing to release
          start();
        });
        const un = () => {
          unStatus();
          unEnded();
        };
        if (done) un();
        else off = un;
      })
      .catch(() => {});
  start();
  return () => {
    if (done) return;
    done = true;
    off?.();
    if (id !== null) void invoke("scm_unwatch", { id });
  };
}
