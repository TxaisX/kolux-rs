// SET-059: the optional prompt-cache countdown on a worktree's sidebar card once a Claude agent goes
// idle. The provider keeps a conversation's prompt cache for a while after the last message (5
// minutes, or 1 hour), so the next message within that time is cheaper; after it, the whole
// conversation is sent again without the cache.

export const CACHE_ON = "promptCacheTimer";
export const CACHE_LENGTH = "promptCacheMinutes";
export const CACHE_GONE = "The prompt cache has run out: the next message sends the whole conversation again without the cache.";

/** The timer's length in minutes, or null while it is off (the default). */
export function cacheMinutes(s: Record<string, unknown>): number | null {
  return s[CACHE_ON] === true ? (s[CACHE_LENGTH] === 60 ? 60 : 5) : null;
}

/** When a worktree's cache runs out: the soonest among its Claude panes that went idle (a finished
 *  or interrupted turn, `since` being that moment); null with the timer off or no such pane. */
export function cacheDue(panes: { agent: string; state?: string; since: number }[], minutes: number | null): number | null {
  if (minutes === null) return null;
  const due = panes.filter((p) => p.agent === "claude" && (p.state === "done" || p.state === "interrupted") && p.since > 0).map((p) => p.since + minutes * 60_000);
  return due.length ? Math.min(...due) : null;
}

/** "4:59" counting down from the full length; "last" in the final minute; "gone" at zero. */
export function cacheShown(left: number): { text: string; phase: "counting" | "last" | "gone" } {
  if (left <= 0) return { text: "", phase: "gone" };
  const secs = Math.ceil(left / 1000);
  return { text: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, phase: secs < 60 ? "last" : "counting" };
}
