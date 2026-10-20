// EDIT-002 (T-177): autosave writes an edit a short pause after typing stops. It is off on a new
// install; the pause comes from the settings (a quarter of a second to ten, one second when the
// stored value cannot be read: editorPrefs.ts). It covers ordinary edit tabs and the diff tab of
// one unstaged file; it never covers staged diffs, the All Changes view, conflict views or
// read-only tabs; and it stands down while the changed-on-disk banner is up for the file (so an
// outside edit is never overwritten) and while the file is being moved (EDIT-032).
import { keyOf } from "./buffers";
import { readEditorPrefs } from "../settings/editorPrefs";

/** What kind of tab asks; every flag defaults to false. */
export type TabKind = { readOnly?: boolean; staged?: boolean; combined?: boolean; conflict?: boolean };

/** Whether autosave may ever write this kind of tab. */
export const covers = (t: TabKind): boolean => !t.readOnly && !t.staged && !t.combined && !t.conflict;

// EDIT-032: a file Kolux is moving is not written by autosave until the new place is confirmed.
const moving = new Set<string>();
export const beginMove = (path: string): void => void moving.add(keyOf(path));
export const endMove = (path: string): void => void moving.delete(keyOf(path));
export const movingNow = (path: string): boolean => moving.has(keyOf(path));

type Timers = { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const real: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export type AutosaveOptions = {
  /** The settings now: autosave on or off and the pause, read at every edit so a change applies at once. */
  prefs: () => { autoSave: boolean; autoSaveDelay: number };
  /** Whether this tab is a kind autosave covers. */
  covered: () => boolean;
  /** Whether the tab holds unsaved text. */
  dirty: () => boolean;
  /** Whether autosave must stand down now (the banner is up, or the file is mid-move). */
  held: () => boolean;
  /** The same save Mod+S runs. */
  write: () => unknown;
  timers?: Timers;
};

export type Autosave = {
  /** The text changed: restart the pause. */
  edit(): void;
  /** The hold ended (Reload or Keep my edits, move confirmed): save what is still unsaved, after the pause. */
  resume(): void;
  /** The tab closes or the file changes: drop a pending write. */
  cancel(): void;
  pending(): boolean;
};

export function createAutosave(o: AutosaveOptions): Autosave {
  const t = o.timers ?? real;
  let timer: unknown = null;
  const cancel = () => {
    if (timer !== null) t.clear(timer);
    timer = null;
  };
  const arm = () => {
    cancel();
    const p = o.prefs();
    if (!p.autoSave || !o.covered()) return;
    timer = t.set(() => {
      timer = null;
      // Stands down, it does not wait: the next edit or resume() starts a new pause.
      if (o.covered() && o.dirty() && !o.held()) void o.write();
    }, p.autoSaveDelay);
  };
  return {
    edit: arm,
    resume: () => {
      if (o.dirty()) arm();
    },
    cancel,
    pending: () => timer !== null,
  };
}

/** The settings autosave reads: fetched again at an edit, at most every `ms`, so switching autosave
 *  on in Settings reaches tabs that are already open. `read` is the settings fetch (get_settings). */
export function prefsReader(read: () => Promise<Record<string, unknown>>, ms = 5000, clock: () => number = Date.now) {
  let cur = readEditorPrefs({});
  let at = -Infinity;
  return {
    get: () => cur,
    refresh: (): Promise<void> => {
      if (clock() - at < ms) return Promise.resolve();
      at = clock();
      return read().then(
        (s) => void (cur = readEditorPrefs(s)),
        () => undefined,
      );
    },
  };
}
