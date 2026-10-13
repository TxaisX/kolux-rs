// TERM-047: the closed-tab ring. Up to CLOSED_MAX closed panes are remembered, newest first; reopen
// takes the newest and puts it back in its folder, remapped when that path form no longer exists
// (a worktree deleted, a drive letter gone). Pure: the caller (App.tsx, split line T-164-b) owns the
// ring state, the pane record shape and the "does this folder exist" check.
export const CLOSED_MAX = 10;

export function remember<T>(ring: readonly T[], tab: T): T[] {
  return [tab, ...ring].slice(0, CLOSED_MAX);
}

/** Other spellings of the same folder: G:\x, G:/x and /g/x. The original comes first. */
export function pathForms(p: string): string[] {
  const forms = [p];
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  const posix = /^\/([A-Za-z])\/(.*)$/.exec(p);
  if (drive) forms.push(`${drive[1].toUpperCase()}:\\${drive[2].replace(/\//g, "\\")}`, `${drive[1].toUpperCase()}:/${drive[2].replace(/\\/g, "/")}`, `/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`);
  else if (posix) forms.push(`${posix[1].toUpperCase()}:\\${posix[2].replace(/\//g, "\\")}`, `${posix[1].toUpperCase()}:/${posix[2]}`);
  return [...new Set(forms)];
}

/** Pop the newest closed tab, its folder remapped to the first form that still exists, else `fallback`. */
export function reopen<T extends { cwd: string }>(ring: readonly T[], exists: (path: string) => boolean, fallback: string): { tab: T | null; ring: T[] } {
  const [tab, ...rest] = ring;
  if (!tab) return { tab: null, ring: [] };
  const cwd = pathForms(tab.cwd).find(exists) ?? fallback;
  return { tab: { ...tab, cwd }, ring: rest };
}
