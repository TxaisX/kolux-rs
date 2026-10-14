/** GIT-058: a pasted GitHub issue or pull request link, cleaned to `https://host/owner/repo/pull|issues/N`; null for anything else. */
export function githubItem(text: string): string | null {
  const m = /^https:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/(pull|issues)\/(\d+)(?:[/?#]\S*)?$/.exec(text.trim());
  return m ? `https://${m[1]}/${m[2]}/${m[3]}/${m[4]}/${m[5]}` : null;
}

/** GIT-058: the workspace whose linked pull request (the `scmLinkedPrs` setting) is this item, else null. */
export function workspaceFor(item: string, linked: Record<string, string>): string | null {
  return Object.keys(linked).find((dir) => githubItem(linked[dir]) === item) ?? null;
}
