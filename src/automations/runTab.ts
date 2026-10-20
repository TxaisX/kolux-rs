// AUTO-011 (T-085-g): the self-closing run tab, as pure functions so the rule is tested without a
// window. A run's agent opens in a background tab; when that agent exits the tab shuts by itself,
// once, unless the user clicked or typed in it. Only a tab a run itself opened is ever followed:
// every other tab (a shell, an agent the user started, a run's setup or default tabs) is not here.

/** Each followed tab by pane key: the run that opened it and whether the user has touched it. */
export type RunTabs = Record<number, { runId: string; touched: boolean }>;

/** What to do with a tab whose program just exited. */
export type Verdict = "close" | "keep" | "ignore";

/** A run opened pane `key` (the agent's own tab). */
export function openRunTab(tabs: RunTabs, key: number, runId: string): RunTabs {
  return { ...tabs, [key]: { runId, touched: false } };
}

/** The user clicked or typed in pane `key`. A pane no run opened is left out, so nothing else is tracked. */
export function touchRunTab(tabs: RunTabs, key: number): RunTabs {
  const t = tabs[key];
  return !t || t.touched ? tabs : { ...tabs, [key]: { ...t, touched: true } };
}

/** The pane is gone by other means (closed by the user, replaced): it is no longer followed. */
export function forgetRunTab(tabs: RunTabs, key: number): RunTabs {
  if (!(key in tabs)) return tabs;
  const { [key]: _gone, ...rest } = tabs;
  return rest;
}

/**
 * The program in pane `key` exited. A run's untouched tab closes; one the user clicked or typed in
 * stays, and so does one the user pinned (pinning is the user saying the tab is theirs). The run's
 * end is the agent's exit however it went: a failed run closes too, since its Runs page entry keeps
 * the end of the output and the reason (AUTO-014). The tab is followed once: after this answer it is
 * forgotten, so a later exit event for the same pane never closes anything.
 */
export function runTabEnded(tabs: RunTabs, key: number, pinned: boolean): { verdict: Verdict; tabs: RunTabs } {
  const t = tabs[key];
  if (!t) return { verdict: "ignore", tabs };
  return { verdict: t.touched || pinned ? "keep" : "close", tabs: forgetRunTab(tabs, key) };
}

/** The pane that holds terminal `id`, from the app's pane-to-terminal map. */
export function paneOfTerminal(ptys: Record<number, number>, id: number): number | null {
  const hit = Object.entries(ptys).find(([, t]) => t === id);
  return hit ? Number(hit[0]) : null;
}

/**
 * A keyboard event counts as the user typing in a followed tab only when it lands inside the pane
 * that is focused and that pane is a followed tab. Kolux's own writes (the opening prompt typed in
 * by the app, a program's terminal replies) are not DOM key events, so they never count.
 */
export function typedInRunTab(tabs: RunTabs, focused: number, insideFocusedPane: boolean): boolean {
  return insideFocusedPane && focused in tabs;
}
