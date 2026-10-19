// GIT-043 (T-231-e): the Tasks repository picker. One row per GitHub project (a repository on a
// host), folding every checkout of it together; projects with no GitHub remote are left out and
// projects still being checked stay visible. The choice is remembered, a count shows when several
// are chosen, and a host that cannot be reached is named. Pure: the page reads the remotes.
import type { Task, TaskPage } from "./model";
import type { GhRepo } from "./repoFacts";

export type PickerProject = { id: string; name: string; path: string };
/** What a project's remote read said: undefined while checking, null for no GitHub remote. */
export type RemoteRead = GhRepo | null | undefined;
export type PickerRow = { key: string; host: string; repo: string; checking: boolean; label: string; projects: PickerProject[] };

/** The setting that keeps the choice (row keys, first chosen first). */
export const REPOS_SETTING = "tasksRepos";

/** One GitHub project's identity: host and owner/name, case-insensitive (GitHub names are). */
export const rowKey = (g: { host: string; owner: string; name: string }): string => `${g.host}/${g.owner}/${g.name}`.toLowerCase();

/** The rows: GitHub projects (checkouts of one folded into one row, listed under it) first in name
 * order, then the ones still being checked. A project whose read said null has no row. */
export function pickerRows(projects: PickerProject[], reads: Record<string, RemoteRead>): PickerRow[] {
  const rows = new Map<string, PickerRow>();
  const checking: PickerRow[] = [];
  for (const p of projects) {
    const r = reads[p.path];
    if (r === null) continue;
    if (r === undefined) {
      checking.push({ key: `checking:${p.path}`, host: "", repo: "", checking: true, label: p.name, projects: [p] });
      continue;
    }
    const key = rowKey(r);
    const row = rows.get(key);
    if (row) row.projects.push(p);
    else rows.set(key, { key, host: r.host, repo: `${r.owner}/${r.name}`, checking: false, label: `${r.owner}/${r.name}`, projects: [p] });
  }
  return [...[...rows.values()].sort((a, b) => a.label.localeCompare(b.label)), ...checking];
}

/** The remembered choice read back from settings: strings only. */
export function savedChoice(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : [];
}

/** The rows chosen now, in the order they were chosen. A remembered row that is gone drops out; with
 * nothing left the checkout on screen's row (`active`) is chosen, else the first row. Rows still
 * being checked are never chosen: they have no repository yet. */
export function chosenRows(rows: PickerRow[], saved: string[], active: string | null): PickerRow[] {
  const ready = rows.filter((r) => !r.checking);
  const picked = saved.map((k) => ready.find((r) => r.key === k)).filter((r): r is PickerRow => !!r);
  if (picked.length) return picked;
  const own = active ? ready.find((r) => r.key === active) : undefined;
  const first = own ?? ready[0];
  return first ? [first] : [];
}

/** The choice after clicking `key`: a chosen row is removed, another added at the end. The last
 * chosen row cannot be removed, so the list never has nothing to ask. */
export function toggled(chosen: string[], key: string): string[] {
  if (!chosen.includes(key)) return [...chosen, key];
  return chosen.length > 1 ? chosen.filter((k) => k !== key) : chosen;
}

/** What the picker button says: the repository, or a count when several are chosen. */
export function pickerLabel(chosen: PickerRow[]): string {
  if (chosen.length === 0) return "No repository";
  return chosen.length === 1 ? chosen[0].label : `${chosen.length} repositories`;
}

/** The chosen repositories per host, the hosts in the order first chosen. */
export function byHost(chosen: PickerRow[]): { host: string; repos: string[] }[] {
  const out: { host: string; repos: string[] }[] = [];
  for (const r of chosen) {
    const at = out.find((h) => h.host.toLowerCase() === r.host.toLowerCase());
    if (at) at.repos.push(r.repo);
    else out.push({ host: r.host, repos: [r.repo] });
  }
  return out;
}

/** GIT-046: where a new issue can go: the chosen repositories on the first chosen one's host, the
 * first chosen first (`first` is the issue source of that repository when a fork reads its parent's). */
export function newIssueTargets(chosen: PickerRow[], source?: string): string[] {
  const host = chosen[0]?.host.toLowerCase();
  const same = chosen.filter((r) => r.host.toLowerCase() === host).map((r) => r.repo);
  return [...new Set([...(source ? [source] : []), ...same])];
}

/** Whether the repository is added in Kolux: a project's checkout is on this machine for it (a row
 * with at least one project, on that host; names compare without case). */
export const repoAdded = (rows: PickerRow[], host: string, repo: string): boolean => rows.some((r) => !r.checking && r.projects.length > 0 && r.host.toLowerCase() === host.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase());

/** The pages several hosts answered with, as one: items newest-updated first, totals added. With
 * `hosts` (the host of each page, same order) every row is stamped with the host it came from. */
export function mergePages(pages: TaskPage[], hosts?: string[]): TaskPage {
  if (pages.length === 1 && !hosts) return pages[0];
  const items: Task[] = pages.flatMap((p, i) => (hosts ? p.items.map((t) => ({ ...t, host: hosts[i] })) : p.items));
  items.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return { total: pages.reduce((n, p) => n + p.total, 0), deepest: Math.max(0, ...pages.map((p) => p.deepest)), items };
}

/** One warning per host that did not answer, naming the host; an empty list when all answered. */
export function hostWarnings(failed: { host: string; error: string }[]): string[] {
  return failed.map((f) => `${f.host} could not be reached (${f.error.replace(/\s+/g, " ").trim().slice(0, 160)}); its repositories are missing from this list.`);
}
