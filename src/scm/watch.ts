// GIT-001 (T-033-b): the git status watcher, front end. The back end keeps one watch per
// worktree (scm_watch); it reads the status after a change has settled, every 30 s as a safety
// net, or every 4 s for a worktree it cannot watch, and sends it as `scm-status-<id>`. Source
// Control, the diff tab and All Changes subscribe here instead of polling.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Status } from "./model";

export type WatchStart = { id: number; worktree: string; watching: boolean };

/** Calls `onStatus` with the fresh status of the worktree holding `path` (a folder or a file in
 *  it) whenever git state there moves. Returns the unsubscribe; safe to call before the watch
 *  has started. A path outside any Git worktree simply never calls back. */
export function watchStatus(path: string, onStatus: (s: Status) => void): () => void {
  let done = false;
  let id: number | null = null;
  let off: (() => void) | null = null;
  void invoke<WatchStart>("scm_watch", { path })
    .then(async (w) => {
      id = w.id;
      if (done) return void invoke("scm_unwatch", { id: w.id });
      const un = await listen<Status>(`scm-status-${w.id}`, (e) => !done && onStatus(e.payload));
      if (done) un();
      else off = un;
    })
    .catch(() => {});
  return () => {
    if (done) return;
    done = true;
    off?.();
    if (id !== null) void invoke("scm_unwatch", { id });
  };
}
