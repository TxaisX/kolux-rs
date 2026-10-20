// PROJ-035: how the sidebar setup card asks. It is asked again when the window gains focus or another
// workspace becomes active, and a slow answer for the earlier ask must never replace a newer one.

/** The project whose workspace is `activeDir`, or null: the card belongs to that project. */
export function cardProjectOf<P extends { id: string }, W extends { path: string }>(projects: P[], worktrees: Record<string, W[]>, activeDir: string | null, same: (a: string, b: string) => boolean): P | null {
  if (activeDir === null) return null;
  return projects.find((p) => (worktrees[p.id] ?? []).some((w) => same(w.path, activeDir))) ?? null;
}

/** Hands out one ticket per ask; only the newest ticket still answers true. */
export function newestOnly(): { begin: () => () => boolean } {
  let latest = 0;
  return {
    begin: () => {
      const mine = ++latest;
      return () => mine === latest;
    },
  };
}
