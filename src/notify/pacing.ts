// STAT-044: notifications are merged and paced. Repeats for one worktree inside the cooldown are
// one notification (a task-complete and a terminal bell for the same event included); every event
// carries a fixed id so the same event never shows twice; the memory of ids, worktrees and click
// targets stays bounded during bursts; test notifications ignore all of it; the worktree in view stays
// quiet while the window has focus if that option is on (other worktrees still show, STAT-041).
// Clicking a notification focuses the pane that raised it:
// `paneFor` answers the id with the pane. Pure functions over a small state, so every rule is tested.

export type NotifyKind = "finish" | "stop" | "bell" | "quiet" | "test";
export type NotifyEvent = {
  /** A fixed identity for the event; the same event reported twice has the same id. */
  id: string;
  /** The worktree the event is about; events without one are never merged with each other. */
  worktree: string | null;
  /** The pane that raised it, for the click. */
  pane: string | null;
  kind: NotifyKind;
  /** Milliseconds, the caller's clock. */
  at: number;
};
export type PacerState = {
  /** Ids already handled, newest last. */
  seen: string[];
  /** When each worktree last had a notification shown, newest last. */
  last: Array<[string, number]>;
  /** Id to pane, newest last. */
  targets: Array<[string, string]>;
};
export type Decision = { show: boolean; reason: "shown" | "duplicate" | "cooldown" | "focused"; state: PacerState };

/** Repeats for one worktree closer than this are merged (DECISIONS: 5 s, a burst of agents ending
 * together reads as one event). */
export const COOLDOWN_MS = 5000;
/** How many ids, worktrees and click targets are remembered; the oldest go first. */
export const MAX_TRACKED = 64;

export function emptyPacer(): PacerState {
  return { seen: [], last: [], targets: [] };
}

const keep = <T>(list: T[]): T[] => (list.length > MAX_TRACKED ? list.slice(list.length - MAX_TRACKED) : list);
const normWorktree = (w: string | null): string | null => (w === null ? null : w.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());

/** The id of one agent event: the pane, what happened and the moment it was reported (a hook stamp or
 * the clock), so two real finishes are two events even inside one clock minute; a repeat that arrives
 * right after is merged by the cooldown, not by the id. A hook sequence number would be exact (T-125-b). */
export function eventId(pane: string, what: string, stamp: number): string {
  return `${pane}:${what}:${stamp}`;
}

/** Decides whether this event is shown and remembers it either way (a held-back event is still that
 * event, so it never comes back later as a duplicate). `focusedWorktree` is the worktree in view. */
export function decide(state: PacerState, ev: NotifyEvent, opts: { windowFocused: boolean; suppressFocused: boolean; focusedWorktree?: string | null }): Decision {
  if (ev.kind === "test") return { show: true, reason: "shown", state };
  if (state.seen.includes(ev.id)) return { show: false, reason: "duplicate", state };
  const seen = keep([...state.seen, ev.id]);
  const targets = ev.pane === null ? state.targets : keep([...state.targets.filter(([id]) => id !== ev.id), [ev.id, ev.pane] as [string, string]]);
  const wt = normWorktree(ev.worktree);
  // "Stay quiet about the worktree you are looking at": only that worktree, only while Kolux has focus;
  // an out-of-view worktree's event still shows (STAT-041), and so does one with no worktree.
  if (opts.suppressFocused && opts.windowFocused && wt !== null && wt === normWorktree(opts.focusedWorktree ?? null)) {
    return { show: false, reason: "focused", state: { ...state, seen, targets } };
  }
  if (wt !== null) {
    const lastShown = state.last.find(([w]) => w === wt)?.[1];
    if (lastShown !== undefined && ev.at - lastShown < COOLDOWN_MS && ev.at >= lastShown) {
      return { show: false, reason: "cooldown", state: { ...state, seen, targets } };
    }
  }
  const last = wt === null ? state.last : keep([...state.last.filter(([w]) => w !== wt), [wt, ev.at] as [string, number]]);
  return { show: true, reason: "shown", state: { seen, last, targets } };
}

/** The pane a notification with this id was raised for, or null when it is unknown or forgotten. */
export function paneFor(state: PacerState, id: string): string | null {
  return state.targets.find(([i]) => i === id)?.[1] ?? null;
}
