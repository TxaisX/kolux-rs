/** GitHub's own rules for an owner (user or organisation) and a repository name. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * GIT-058: a pasted GitHub issue or pull request link, cleaned to `https://host/owner/repo/pull|issues/N`;
 * null for anything else. Only the listed hosts are accepted (github.com unless the caller names
 * its GitHub Enterprise hosts), and a link naming a user, a password or a port is refused, so the
 * cleaned link always opens the host it shows (FIX-2). The path is checked as typed, before any
 * `..` or backslash could be resolved away.
 */
export function githubItem(text: string, hosts: readonly string[] = ["github.com"]): string | null {
  const raw = text.trim();
  if (!/^https:\/\/\S+$/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  const typed = raw.slice("https://".length);
  const authority = typed.split(/[/?#]/)[0];
  if (authority.toLowerCase() !== url.hostname || !hosts.some((h) => h.toLowerCase() === url.hostname)) return null;
  const [owner, repo, kind, num] = typed.slice(authority.length).split(/[?#]/)[0].split("/").slice(1);
  if (!owner || !OWNER.test(owner) || !repo || !REPO.test(repo) || repo === "." || repo === "..") return null;
  if ((kind !== "pull" && kind !== "issues") || !/^\d+$/.test(num ?? "")) return null;
  return `https://${url.hostname}/${owner}/${repo}/${kind}/${num}`;
}

/** GIT-058: the workspace whose linked pull request (the `scmLinkedPrs` setting) is this item, else null. */
export function workspaceFor(item: string, linked: Record<string, string>, hosts: readonly string[] = ["github.com"]): string | null {
  return Object.keys(linked).find((dir) => githubItem(linked[dir], hosts) === item) ?? null;
}
