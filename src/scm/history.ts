// VIEW-071: the history list in the sidebar. A load is tagged with the worktree it was asked for
// and a running number; a slow load never replaces a newer one, and a list for another worktree is
// never drawn, not even for the frame before the old one is cleared.
import type { Commit } from "./model";

export type LoadedHistory = { dir: string; seq: number; commits: Commit[] };

/** Hands out load numbers; only the newest number is ever accepted. */
export class HistoryLoads {
  private last = 0;
  /** A new load starts: it is now the only one whose answer counts. */
  begin(): number {
    return ++this.last;
  }
  /** Whether the answer of load `seq` may replace what is shown. */
  current(seq: number): boolean {
    return seq === this.last;
  }
}

/** What an answer does to the list on screen: it replaces it only when it is the newest load. */
export const acceptHistory = (loads: HistoryLoads, seq: number, dir: string, commits: Commit[], shown: LoadedHistory | null): LoadedHistory | null =>
  loads.current(seq) ? { dir, seq, commits } : shown;

/** The commits to draw for `dir`: a list loaded for any other worktree is never shown. */
export const historyFor = (shown: LoadedHistory | null, dir: string | null): Commit[] | null => (shown !== null && dir !== null && shown.dir === dir ? shown.commits : null);
