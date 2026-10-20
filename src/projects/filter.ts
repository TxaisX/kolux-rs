// PROJ-052: filters on the workspace list. Pure, so the rules are tested on their own.
// Hiding sleeping workspaces is the VIEW-053 switch ("showSleeping" off); the rest live here.

import { SHOW_SLEEPING_SETTING, showSleepingFrom } from "./rows";

/** Hide the default-branch row (the main checkout on a branch). */
export const FILTER_DEFAULT_SETTING = "filterHideDefaultBranch";
/** Let hiding sleeping workspaces hide a sleeping default-branch row too (off: that row stays). */
export const FILTER_SLEEPING_DEFAULT_SETTING = "filterSleepingHidesDefault";
/** Project ids to show; empty means every project. */
export const FILTER_PROJECTS_SETTING = "filterProjects";
/** The retired "active workspaces only" filter: never read back from an old settings file. */
export const RETIRED_ACTIVE_ONLY = "filterActiveOnly";

export type Filters = { hideSleeping: boolean; hideDefault: boolean; sleepingHidesDefault: boolean; projects: string[] };

export function filtersFrom(settings: Record<string, unknown>): Filters {
  const projects = settings[FILTER_PROJECTS_SETTING];
  return {
    hideSleeping: !showSleepingFrom(settings[SHOW_SLEEPING_SETTING]),
    hideDefault: settings[FILTER_DEFAULT_SETTING] === true,
    sleepingHidesDefault: settings[FILTER_SLEEPING_DEFAULT_SETTING] === true,
    projects: Array.isArray(projects) ? projects.filter((x): x is string => typeof x === "string") : [],
  };
}

/** Only a main checkout backed by a branch is the default-branch row; a folder project's root has no branch, so never. */
export const isDefaultRow = (w: { isMain: boolean; branch: string | null }): boolean => w.isMain && !!w.branch;

export type FilterRow = { projectId: string; isMain: boolean; branch: string | null; asleep: boolean };

export function rowShown(f: Filters, r: FilterRow): boolean {
  if (f.projects.length > 0 && !f.projects.includes(r.projectId)) return false;
  const def = isDefaultRow(r);
  if (def && f.hideDefault) return false;
  if (f.hideSleeping && r.asleep && !(def && !f.sleepingHidesDefault)) return false;
  return true;
}

/** How many filters are on (the control shows it; zero means the list is whole). */
export function filtersOn(f: Filters): number {
  return Number(f.hideSleeping) + Number(f.hideDefault) + Number(f.projects.length > 0);
}

/** What "clear filters" writes: every filter back to its off value. */
export const CLEAR_FILTERS: [string, unknown][] = [
  [SHOW_SLEEPING_SETTING, true],
  [FILTER_DEFAULT_SETTING, false],
  [FILTER_PROJECTS_SETTING, []],
];

/** The project filter after one project's box is toggled; showing every project is the empty list. */
export function toggleProject(f: Filters, all: string[], id: string): string[] {
  const now = f.projects.length === 0 ? all : f.projects;
  const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
  return next.length === all.length || next.length === 0 ? [] : next;
}
