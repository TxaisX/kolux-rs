// STAT-048: the app badge counts the workspaces with agent results not yet seen. Unread tabs count
// once, under their workspace; the count is capped; zero clears the badge. The page passes the
// count to the `badge_set` command, which paints the Windows taskbar overlay (or sets the macOS
// badge) and ignores any failure to clear it.

/** The largest number the badge shows; anything more reads as "99+". */
export const BADGE_CAP = 99;

const norm = (dir: string): string => dir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** How many distinct workspaces are in the unread set, capped. */
export function badgeCount(unreadDirs: Iterable<string>): number {
  const dirs = new Set<string>();
  for (const d of unreadDirs) dirs.add(norm(d));
  return Math.min(BADGE_CAP, dirs.size);
}
