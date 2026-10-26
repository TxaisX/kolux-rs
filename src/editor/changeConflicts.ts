// GIT-017 (T-227-d) in All Changes: a message is written from a diff that leaves out files with an
// unresolved conflict; the combined-changes tab lists those files first, marks them, and draws no diff for them.
import type { Status } from "../scm/model";

type Listed = { path: string; clash?: string };

const slash = (p: string) => p.replace(/\\/g, "/");

/** The worktree-relative path (forward slashes) of an entry's absolute path. */
export const relPath = (root: string, p: string) => slash(p).slice(slash(root).length).replace(/^\/+/, "");

/** The unresolved conflicts of a status, by worktree-relative path, with git's two-letter code. */
export function clashesOf(status: Status | null): Map<string, string> {
  return new Map((status?.conflicts ?? []).map((c) => [slash(c.path), c.status]));
}

/** The entries with conflicted files first and one entry per conflicted file (git lists an unmerged
 * path on both sides of the index), each marked with its clash code; the rest keep their order. */
export function withClashes<E extends Listed>(entries: E[], clashes: Map<string, string>, root: string): E[] {
  if (clashes.size === 0) return entries;
  const seen = new Set<string>();
  const hit: E[] = [];
  const rest: E[] = [];
  for (const e of entries) {
    const code = clashes.get(relPath(root, e.path));
    if (code === undefined) rest.push(e);
    else if (!seen.has(e.path)) {
      seen.add(e.path);
      hit.push({ ...e, clash: code });
    }
  }
  return [...hit, ...rest];
}
