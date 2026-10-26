// SKILL-024 / SKILL-026: what the out-of-date notice and the background update dialog show.
// The checks themselves are in src-tauri/src/skills/update.rs; this is only the wording and the rules
// about when the notice appears (never in a project copy, never twice in a session, never again once
// dismissed for the same copy and revision, never before settings have loaded).

export type CopyRow = { path: string; source: string; chips: string[]; eligible: boolean; reason: string | null };
export type UpdateRow = { name: string; state: "available" | "current" | "skipped"; reason: string | null; reinstall: string | null; copies: CopyRow[] };
export type Report = { rows: UpdateRow[]; available: number; revisions: string[]; notice: string[] };
export type Checked = { report: Report; dismissed: string[] };
export type Outcome = { name: string; ok: boolean; reason: string | null };
export type UpdateStatus = { state: "idle" | "running" | "stopping" | "done"; names: string[]; command: string; log: string; code: number | null; stopped: boolean; error: string | null; results: Outcome[] };

/** The notice keys (skill file + revision of the qualifying, non-project copies) not yet dismissed. */
export const freshKeys = (c: Checked): string[] => c.report.notice.filter((k) => !c.dismissed.includes(k));

/** The notice shows once settings have loaded, when something qualifies that was not dismissed, and
 * not again in the same session (`shownThisSession`), whether it was dismissed or opened. */
export const noticeShown = (c: Checked | null, settingsLoaded: boolean, shownThisSession: boolean): boolean => !!c && settingsLoaded && !shownThisSession && c.report.available > 0 && freshKeys(c).length > 0;

let claimed = false;
/** After-list row 62: true the first time the notice may show this session; the window and the Skills page share the one claim. */
export function claimNotice(c: Checked | null, settingsLoaded: boolean): boolean {
  if (!noticeShown(c, settingsLoaded, claimed)) return false;
  claimed = true;
  return true;
}
export const resetNoticeClaim = () => void (claimed = false);

export const noticeText = (n: number): string => (n === 1 ? "1 Kolux skill has an update." : `${n} Kolux skills have updates.`);

/** Names the notice offers: skills with a qualifying copy. */
export const updatable = (r: Report): string[] => r.rows.filter((x) => x.state === "available").map((x) => x.name);

export const UPDATE_LABEL = "Update";
export const UPDATING_LABEL = "Updating...";
export const STOP_LABEL = "Stop";
export const NO_NODE_HELP = "The community skills installer needs Node.js. Install it, then try again.";

/** One line for a finished run: what was updated and what was not. */
export function sumUpRun(s: UpdateStatus): string {
  if (s.error) return s.error;
  const ok = s.results.filter((r) => r.ok).length;
  const bad = s.results.length - ok;
  if (s.stopped) return bad === s.results.length ? "Stopped. Nothing was updated." : `Stopped. ${ok} updated, ${bad} not.`;
  if (bad === 0) return ok === 1 ? "Updated 1 skill." : `Updated ${ok} skills.`;
  return ok === 0 ? "The update did not change anything. Show log has the installer's output." : `Updated ${ok}, ${bad} still out of date. Show log has the installer's output.`;
}

/** The chip's tone: a copy that cannot be updated reads as a warning, the rest as information. */
export const chipTone = (chip: string): "info" | "warn" =>
  ["unrecognised", "inaccessible", "external link", "broken link", "read only", "inside a repo", "plugin cache"].includes(chip) ? "warn" : "info";
