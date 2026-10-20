// GIT-001 (T-033-b): the git status watcher, front end. The back end keeps one watch per
// worktree (scm_watch); it reads the status after a change has settled, every 30 s as a safety
// net, or every 4 s for a worktree it cannot watch, and sends it as `scm-status-<id>`. Source
// Control, the diff tab and All Changes subscribe here instead of polling. FIX-1 (T-033-e
// review): a watch that ended on its own (its folder went, or a workspace removal that then
// failed) says so as `scm-watch-ended-<id>`, and the page watches again instead of going silent.
// FIX-2: while the folder is still missing (git answers from another folder, or not at all), the
// page tries again with backoff for as long as it is open, so a folder that is only briefly
// unreadable (access denied, renamed away and back) gets watched again.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Status } from "./model";

export type WatchStart = { id: number; worktree: string; watching: boolean };

/** How long to wait before watching again after the folder went: 1 s, 4 s, 15 s, then every
 *  30 s (the safety read's own pace) while the page is open. */
export const RETRY_MS = [1_000, 4_000, 15_000, 30_000];

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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tries = 0; // tries since the watch ended; the delay grows with them
  const later = () => {
    if (done) return;
    const ms = RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)];
    timer = setTimeout(() => {
      timer = null;
      start();
    }, ms);
  };
  const start = () =>
    void invoke<WatchStart>("scm_watch", { path })
      .then(async (w) => {
        if (done) return void invoke("scm_unwatch", { id: w.id });
        // Watching again after the folder went: git can only answer from the nearest folder that
        // exists, which may be another worktree's (the project around a removed workspace). That
        // watch is somebody else's: let it go at once, stay quiet, and try again later.
        if (worktree !== null && !sameWorktree(worktree, w.worktree)) {
          void invoke("scm_unwatch", { id: w.id });
          return later();
        }
        id = w.id;
        worktree = w.worktree;
        tries = 0;
        // Both listeners register in one round trip (FIX-2): a watch that ends while the status
        // listener is going up is still heard.
        const [unStatus, unEnded] = await Promise.all([
          listen<Status>(`scm-status-${w.id}`, (e) => !done && onStatus(e.payload)),
          listen(`scm-watch-ended-${w.id}`, () => {
            if (done || id !== w.id) return;
            off?.();
            off = null;
            id = null; // the back end has let this id go already: nothing to release
            start();
          }),
        ]);
        const un = () => {
          unStatus();
          unEnded();
        };
        if (done) un();
        else off = un;
      })
      .catch(() => {
        // The first answer failing means a path outside Git: nothing to watch, ever. After the
        // folder went, it means the folder is still unreadable: try again later.
        if (worktree === null) return;
        if (id !== null) {
          void invoke("scm_unwatch", { id });
          id = null;
        }
        later();
      });
  start();
  return () => {
    if (done) return;
    done = true;
    if (timer !== null) clearTimeout(timer);
    off?.();
    if (id !== null) void invoke("scm_unwatch", { id });
  };
}
