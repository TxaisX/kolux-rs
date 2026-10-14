// ONB-001..005: the first-run wizard's pure rules; Wizard.tsx draws it, onboarding.rs keeps its record.
import { invoke } from "@tauri-apps/api/core";
import { sameDir } from "../workspaces";

export const SCREENS = [
  { id: "welcome", name: "Welcome", heading: "Several AIs can work on your files at the same time", sub: "Claude, Codex and Grok each take a part of the job, side by side." },
  { id: "connect", name: "Connect an AI", heading: "Connect an AI", sub: "Sign in with a plan you already pay for. No terminal needed." },
  { id: "work", name: "Your work", heading: "Your work", sub: "Use a folder of your own, or try Kolux on sample data first." },
  { id: "kit", name: "Choose a kit", heading: "Choose a kit", sub: "A ready-made job for your AIs, each in its own role." },
] as const;

/** The record onboarding_get returns while the wizard is still open; `step` is the last screen finished, -1 for none. */
export type Record = { step: number };

/** ONB-001: the screen the wizard opens on, or null when it should not open. */
export const openAt = (rec: Record | null) => (rec ? Math.max(0, Math.min(rec.step + 1, SCREENS.length - 1)) : null);

type Chord = { key: string; ctrlKey: boolean; metaKey: boolean; isComposing: boolean; target: unknown };

/** ONB-001: Ctrl+Enter (Cmd+Enter on a Mac) fires the main button; never from a text field, mid-composition or while it is off. */
export function chordFires(e: Chord, disabled: boolean): boolean {
  if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.isComposing || disabled) return false;
  const t = e.target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!t) return true;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return false;
  return !(t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range"].includes(t.type ?? "text"));
}

/** ONB-005: Start kit skips the setup dialog only in the kit's own sample folder (which fills every input) with an AI ready. */
export const kitLaunch = (dir: string | null, sampleDir: string | null, connected: string[]): "launch" | "setup" =>
  dir && sampleDir && connected.length > 0 && sameDir(dir, sampleDir) ? "launch" : "setup";

/** ONB-004: 'Pick a folder' hands over to the sidebar's Add Project dialog through this window event. */
export const ADD_PROJECT = "kolux-add-project";

/** ONB-006: Escape asks whether to leave, unless something inside already handled it or a composition is running. */
export const leaveKey = (e: { key: string; isComposing: boolean; defaultPrevented: boolean }) => e.key === "Escape" && !e.isComposing && !e.defaultPrevented;

export type Outcome = "completed" | "dismissed";

/** ONB-009: the help menu's Onboarding item asks the window to start the wizard over through this event. */
export const REOPEN_WIZARD = "kolux-reopen-wizard";

/** ONB-009: true for a click that counts; one less than half a second after the click before it does not. */
export function oneClick(gap = 500) {
  let last = -Infinity;
  return (now = Date.now()) => {
    const counts = now - last >= gap;
    last = now;
    return counts;
  };
}

/** ONB-011: the first-success milestones onboarding.rs keeps, each once, on this machine only. */
export type Milestone = "aiConnected" | "kitLaunched" | "resultsOpened";

/** ONB-011: records a milestone (kept only the first time); the user sees nothing, even when the write fails. */
export const milestone = (name: Milestone, send: (cmd: string, args: { name: Milestone }) => Promise<unknown> = invoke): Promise<void> =>
  send("onboarding_milestone", { name }).then(
    () => {},
    () => {},
  );

/** ONB-007: closing is latched while it is being stored; a failed store frees the latch and keeps
 * the close, so the next click on any of the wizard's ways out tries the same close once more. */
export function closer(store: (outcome: Outcome) => Promise<unknown>, done: () => void, fail: (err: unknown) => void) {
  let busy = false;
  let failed: { outcome: Outcome; after: () => void } | null = null;
  const end = (outcome: Outcome, after: () => void = () => {}) => {
    if (busy) return;
    busy = true;
    store(outcome).then(
      () => {
        busy = false;
        failed = null;
        done();
        after();
      },
      (err) => {
        busy = false;
        failed = { outcome, after };
        fail(err);
      },
    );
  };
  /** True when a failed close was tried again instead of the click's own action. */
  const retry = () => {
    if (!failed) return false;
    end(failed.outcome, failed.after);
    return true;
  };
  return { end, retry };
}

/** ONB-010: the agent the first folder after onboarding starts: the saved default only; none on
 * automatic (no default) and none for a plain terminal, which the new workspace opens anyway. */
export const firstFolderAgent = <A extends { id: string; installed: boolean }>(offered: A[], defaultId: string): A | null =>
  defaultId === "" || defaultId === "terminal" ? null : (offered.find((a) => a.installed && a.id === defaultId) ?? null);
