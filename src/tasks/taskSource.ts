// ACCT-057 (T-311): where the Tasks list gets its work from. GitHub is the one shipped source; a saved
// source that is gone, hidden or unknown quietly becomes GitHub, and a GitHub CLI that is signed out
// is shown as unavailable instead of failing. Pure rules; the Tasks header draws the result.

/** The shipped task sources. */
export const TASK_SOURCES: ReadonlyArray<{ id: string; name: string }> = [{ id: "github", name: "GitHub" }];
/** The settings key that remembers a chosen source. */
export const TASK_SOURCE_KEY = "tasksSource";
export const FALLBACK_SOURCE = "github";

export type TaskSourceView = { id: string; name: string; available: boolean; fellBack: boolean; text: string };

/** The source to use: the saved one when it still exists and is not hidden, else GitHub. `login` is the
 * signed-in GitHub account (null = the CLI is signed out or missing, undefined = still checking). */
export function taskSource(settings: Record<string, unknown> | null | undefined, login: string | null | undefined, hidden: readonly string[] = []): TaskSourceView {
  const saved = settings?.[TASK_SOURCE_KEY];
  const known = typeof saved === "string" ? TASK_SOURCES.find((s) => s.id === saved && !hidden.includes(s.id)) : undefined;
  const chosen = known ?? TASK_SOURCES.find((s) => s.id === FALLBACK_SOURCE)!;
  const fellBack = saved !== undefined && saved !== null && saved !== "" && known === undefined;
  const available = login !== null;
  const who = login === undefined ? "checking" : login === null ? "unavailable: the GitHub CLI is signed out" : `@${login}`;
  return { id: chosen.id, name: chosen.name, available, fellBack, text: `${chosen.name} · ${who}` };
}
