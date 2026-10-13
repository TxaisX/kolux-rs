// EDIT-002: autosave. Off on a new install; once on, an edit tab or an unstaged diff tab writes its
// file a short pause after typing stops. Before writing it reads the disk copy, so a file another
// program changed in the meantime is never overwritten: the write is dropped and the tab's
// changed-on-disk banner (EDIT-003) is raised instead. Autosave then stands down for that file
// until the banner is answered or the file is saved or reloaded.
import { diskNews, isDirty, keyOf, save, subscribe } from "./buffers";

export const AUTOSAVE_KEY = "editorAutosave";
export const AUTOSAVE_PAUSE_KEY = "editorAutosavePause";
export const PAUSE_DEFAULT = 1000;
export const PAUSE_MIN = 250;
export const PAUSE_MAX = 10000;

/** The pause in milliseconds when autosave is on, or null when it is off. */
export function autosaveOf(s: Record<string, unknown>): number | null {
  if (s[AUTOSAVE_KEY] !== true) return null;
  const p = s[AUTOSAVE_PAUSE_KEY];
  if (typeof p !== "number" || !Number.isFinite(p)) return PAUSE_DEFAULT;
  return Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, p));
}

const stopped = new Set<string>();
/** The changed-on-disk banner is up for this file: autosave writes nothing until it is answered. */
export const stopAutosave = (path: string) => void stopped.add(keyOf(path));
export const resumeAutosave = (path: string) => void stopped.delete(keyOf(path));
export const isStopped = (path: string) => stopped.has(keyOf(path));

/** Writes the file `pause` ms after its last edit while it is unsaved. `readDisk` is the file as it
 *  is now; a copy that moved under the edits goes to `onConflict` and nothing is written. */
export function watchAutosave(path: string, pause: number, write: (text: string) => Promise<void>, readDisk: () => Promise<string>, onConflict: (disk: string) => void, onError?: (err: unknown) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = async () => {
    if (!isDirty(path) || isStopped(path)) return;
    // ponytail: a disk copy that cannot be read is left alone; Mod+S still writes it.
    const disk = await readDisk().catch(() => null);
    if (disk === null || !isDirty(path) || isStopped(path)) return;
    if (diskNews(path, disk) === "conflict") {
      stopAutosave(path);
      onConflict(disk);
      return;
    }
    await save(path, write).catch((err) => onError?.(err));
  };
  const off = subscribe(path, () => {
    clearTimeout(timer);
    if (!isDirty(path)) return resumeAutosave(path);
    if (!isStopped(path)) timer = setTimeout(() => void fire(), pause);
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}
