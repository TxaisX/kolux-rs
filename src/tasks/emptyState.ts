// T-281 (GIT-045): why the Tasks list shows no rows, in plain words: no project picked, a project with no
// GitHub remote, still loading, a page past the end, a search that matches nothing. Sign-in and reach
// trouble get their own banner (ghHealth.ts). Pure, tested on its own.

export type EmptyFacts = { project: string | null; remote: boolean; loaded: boolean; count: number; query: string; page: number };

/** What to say instead of the list; null when the list has rows. */
export function emptyReason(f: EmptyFacts): string | null {
  if (f.project === null) return "Add a project to see its GitHub issues and pull requests.";
  if (!f.remote) return `${f.project} has no GitHub remote, so there are no issues or pull requests to list. Add one (git remote add origin <url>) and press Refresh.`;
  if (!f.loaded) return "Loading…";
  if (f.count > 0) return null;
  if (f.page > 1) return "This page is past the last result; go back a page.";
  const q = f.query.trim();
  return q ? `Nothing in ${f.project} matches "${q}". Clear the search or pick another filter.` : `Nothing in ${f.project} is in this list. Pick another filter above.`;
}
