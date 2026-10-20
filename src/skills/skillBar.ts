// SKILL-025 (freshness pill) and SKILL-027 / VIEW-100 (the status bar's skill update item).
// Pure rules only: what the pill says for a skill, and how a running skill update shows in the
// status bar over time (updating with its count, a green check that clears itself after about
// 4 seconds, a failure that stays until clicked). The poller, the timers and the clock are in
// skillBarStore.ts; every function here takes the time as an argument.
import type { Checked, UpdateRow, UpdateStatus } from "./updateNotice";

/** A success clears itself this long after it was reported (or after the dialog showing it closed). */
export const FADE_MS = 4000;

export type Phase = "idle" | "running" | "stopping" | "ok" | "failed";
export type BarRun = {
  phase: Phase;
  /** How many skills the run covers. */
  count: number;
  /** The failure's one-line reason, for the item's tooltip. */
  why: string;
  /** When the green check started counting down (null while the dialog holds it open). */
  since: number | null;
  /** The update dialog is open, so the user is reading the outcome. */
  reading: boolean;
};
export const IDLE: BarRun = { phase: "idle", count: 0, why: "", since: null, reading: false };

export type BarEvent =
  | { type: "status"; status: UpdateStatus; now: number }
  | { type: "reading"; open: boolean; now: number }
  | { type: "click" };

const plural = (n: number) => (n === 1 ? "1 skill" : `${n} skills`);

/** The reason a finished run counts as failed, or null when every skill came out updated. */
export function failureOf(s: UpdateStatus): string | null {
  if (s.error) return s.error;
  if (s.stopped) return "The update was stopped.";
  const bad = s.results.filter((r) => !r.ok);
  if (bad.length === 0) return null;
  return bad.length === s.results.length ? "The update did not change anything." : `${bad.length} of ${s.results.length} skills are still out of date.`;
}

export function barReduce(run: BarRun, e: BarEvent): BarRun {
  switch (e.type) {
    case "status": {
      const s = e.status;
      if (s.state === "idle") return run.phase === "failed" || run.phase === "ok" ? run : IDLE;
      if (s.state === "running" || s.state === "stopping") return { phase: s.state, count: s.names.length, why: "", since: null, reading: run.reading };
      // done: the outcome replaces the spinner; a repeat of the same report must not restart the countdown.
      const why = failureOf(s);
      const count = s.results.length || s.names.length;
      if (why) return { phase: "failed", count, why, since: null, reading: run.reading };
      if (run.phase === "ok") return run;
      return { phase: "ok", count, why: "", since: run.reading ? null : e.now, reading: run.reading };
    }
    case "reading":
      if (e.open === run.reading) return run;
      // Closing the dialog starts the green check's 4 seconds; opening it holds the check on screen.
      return { ...run, reading: e.open, since: run.phase === "ok" ? (e.open ? null : e.now) : run.since };
    case "click":
      // A click reopens the dialog (the store raises the show event); it also acknowledges a failure.
      return run.phase === "failed" ? IDLE : run;
  }
}

export type BarItem = { tone: "info" | "ok" | "bad"; text: string; title: string };

/** What the status bar shows now, or null for nothing. */
export function barItem(run: BarRun, now: number): BarItem | null {
  switch (run.phase) {
    case "idle":
      return null;
    case "running":
      return { tone: "info", text: `Updating ${plural(run.count)}`, title: "Updating Kolux skills. Click for details." };
    case "stopping":
      return { tone: "info", text: "Stopping the skill update", title: "Stopping the skill update. Click for details." };
    case "ok":
      return fadedAway(run, now) ? null : { tone: "ok", text: `Updated ${plural(run.count)}`, title: "Skills updated. Click for details." };
    case "failed":
      return { tone: "bad", text: "Skill update failed", title: `${run.why} Click for details.` };
  }
}

/** Whether the green check has been shown long enough (never while the dialog is open). */
export const fadedAway = (run: BarRun, now: number): boolean => run.phase === "ok" && !run.reading && run.since != null && now - run.since >= FADE_MS;

/** Milliseconds until the item changes by itself (the check fading), or null when nothing is pending. */
export function nextChange(run: BarRun, now: number): number | null {
  if (run.phase !== "ok" || run.reading || run.since == null) return null;
  return Math.max(0, run.since + FADE_MS - now);
}

/** Once the check has faded the run is over: the store drops it so the bar stays empty. */
export const settle = (run: BarRun, now: number): BarRun => (fadedAway(run, now) ? IDLE : run);

// ---- the freshness pill (SKILL-025) ---------------------------------------------------------

export type Load = "idle" | "checking" | "failed" | "ready";
export type PillKind = "installed" | "checking" | "failed" | "update" | "review" | "current";
export type Pill = { kind: PillKind; text: string; tone: "info" | "ok" | "warn" | "bad" };

const PILLS: Record<PillKind, Pill> = {
  installed: { kind: "installed", text: "Installed", tone: "info" },
  checking: { kind: "checking", text: "Checking...", tone: "info" },
  failed: { kind: "failed", text: "Check failed", tone: "bad" },
  update: { kind: "update", text: "Update available", tone: "warn" },
  review: { kind: "review", text: "Review", tone: "warn" },
  current: { kind: "current", text: "Up to date", tone: "ok" },
};

/** The pill for one Kolux skill. A copy the user changed (or that the installer has no record of)
 * shows Review, never Update; before the first check there is only "Installed". */
export function pillFor(name: string, load: Load, checked: Checked | null): Pill {
  if (load === "checking") return PILLS.checking;
  if (load === "failed") return PILLS.failed;
  if (load === "idle" || !checked) return PILLS.installed;
  const row: UpdateRow | undefined = checked.report.rows.find((r) => r.name === name);
  if (!row) return PILLS.installed;
  if (row.state === "available") return PILLS.update;
  if (row.state === "current") return PILLS.current;
  // Skipped: changed locally, unrecognised, newer, read only, a plugin's copy ... the user should look.
  return PILLS.review;
}
