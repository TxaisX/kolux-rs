// VIEW-114: what the sidebar's onboarding slot shows. The newcomer checklist (ONB-013) while it is
// shown; otherwise, once onboarding has closed (or the profile predates it), the Setup Guide entry
// while a core step remains. Nothing shows until the reads have answered, so the slot never
// flashes a state it then takes back. Nothing here is sent anywhere: there is no telemetry.
import { GUIDE_CLOSED, ring, STEPS, words, type StepId } from "./guide";
import type { Checklist, FirstRun } from "./newcomer";

export type Slot = "checklist" | "guide" | null;

/** VIEW-114 (FIX-2): sent for every project the sidebar adds (useWizard's projectAdded), so the
 *  entry reads its steps again on an add instead of on every change of the project count. */
export const PROJECT_ADDED = "kolux-project-added";
export const projectAddedNote = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PROJECT_ADDED));
};

/** Window focus re-reads at most this often: each read asks gh, the CLI and every workspace. */
export const FOCUS_FLOOR_MS = 30_000;

/** VIEW-114 (FIX-2 FIX-SOON 2): the events that make the sidebar entry read its steps again: every
 *  Setup Guide close and every added project, and window focus at most once per FOCUS_FLOOR_MS (so a
 *  step done in Settings or outside the app ticks when the user comes back). Returns the cleanup. */
export function onReread(target: EventTarget, bump: () => void, now: () => number = Date.now): () => void {
  let last = -Infinity;
  const focus = () => {
    const t = now();
    if (t - last < FOCUS_FLOOR_MS) return;
    last = t;
    bump();
  };
  target.addEventListener("focus", focus);
  target.addEventListener(GUIDE_CLOSED, bump);
  target.addEventListener(PROJECT_ADDED, bump);
  return () => {
    target.removeEventListener("focus", focus);
    target.removeEventListener(GUIDE_CLOSED, bump);
    target.removeEventListener(PROJECT_ADDED, bump);
  };
}

/** Whether the slot needs the guide's facts at all: the record is read, the checklist is not up and
 *  no wizard is still open. */
export const guideWanted = (c: Checklist, first: FirstRun | null | undefined): boolean => c.ready && !c.show && !(first && !first.closed);

/** The slot, from the checklist, the first-run record and the guide's last fully answered done set
 *  (null while its first read is still out). */
export function sidebarSlot(c: Checklist, first: FirstRun | null | undefined, settled: ReadonlySet<StepId> | null): Slot {
  if (!c.ready) return null;
  if (c.show) return "checklist";
  if (!guideWanted(c, first) || settled === null) return null;
  const r = ring(settled);
  return r.done < r.total ? "guide" : null;
}

/** The entry's words: the count of core steps done and the next unfinished core step's name. */
export function entryLine(settled: ReadonlySet<StepId>): { done: number; total: number; count: string; next: string | null; nextId: StepId | null } {
  const r = ring(settled);
  const step = STEPS.find((s) => s.core && !settled.has(s.id)) ?? null;
  return { done: r.done, total: r.total, count: `${r.done} of ${r.total}`, next: step ? words(step).name : null, nextId: step?.id ?? null };
}
