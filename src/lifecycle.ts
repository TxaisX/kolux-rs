// APP-006 / APP-011: what closing the window asks first, and the durable save point every restart,
// update and reload waits for.
import { invoke } from "@tauri-apps/api/core";
import { saveAll } from "./settings/useSettings";

let drafts: () => string[] = () => [];
/** The window tells this module which editor tabs hold unsaved text (their names). */
export const watchDrafts = (names: () => string[]) => void (drafts = names);
export const unsavedTabs = () => drafts();

const list = (names: string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** APP-011: resolves once everything is saved for good; rejects, saving and tearing down nothing
 * more, while an editor tab holds unsaved text, when a settings field cannot be saved, or when the
 * store cannot write its save point. */
export async function savePoint(): Promise<void> {
  const open = drafts();
  if (open.length) throw new Error(`Save or close ${list(open)} first: unsaved changes would be lost, so nothing was restarted.`);
  if (!(await saveAll())) throw new Error("A setting could not be saved, so nothing was restarted. Try again.");
  try {
    await invoke("save_point");
  } catch (e) {
    throw new Error(String(e));
  }
}

/** APP-006: the question before the window closes, or null when nothing would be lost. */
export function quitQuestion(busy: number, unsaved: string[]): { title: string; body: string } | null {
  if (busy === 0 && unsaved.length === 0) return null;
  const running = busy === 0 ? "" : busy === 1 ? "A program is still running in 1 terminal. Quitting stops it." : `Programs are still running in ${busy} terminals. Quitting stops them.`;
  const lost = unsaved.length === 0 ? "" : `${list(unsaved)} ${unsaved.length === 1 ? "has" : "have"} unsaved changes, which will be lost.`;
  return { title: "Quit Kolux?", body: [running, lost].filter(Boolean).join(" ") };
}
