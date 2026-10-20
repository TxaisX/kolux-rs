// EDIT-004 (T-177): unsaved text survives a quit or a crash. While a tab holds unsaved text a draft
// of it is kept (editor_drafts.rs) a moment after typing stops; the draft is never written into the
// real file. Reopening the file brings the draft back, still marked unsaved. A draft typed over a
// disk copy that has since changed comes back with the changed-on-disk banner up (EDIT-003), so it
// is never laid over the newer disk copy unseen. Read-only tabs never carry a draft.
import { invoke } from "@tauri-apps/api/core";
import { diskOf, hashOf, isDirty, keyOf, sameText, textOf } from "./buffers";

export type Draft = { path: string; text: string; base: string };

/** What to open a file with, given its disk copy and the draft kept for it (if any). `stale` is a
 *  draft that adds nothing (it equals the disk copy) and can be dropped. */
export function restoreFrom(disk: string, diskHash: string, draft: Draft | null): { text: string; moved: boolean; stale: boolean } {
  if (!draft || sameText(draft.text, disk)) return { text: disk, moved: false, stale: !!draft };
  return { text: draft.text, moved: draft.base !== "" && draft.base !== diskHash, stale: false };
}

/** The backing store; the window's own is the Rust commands. */
export type DraftIo = {
  set: (worktree: string, path: string, text: string, base: string) => Promise<unknown>;
  clear: (worktree: string, path: string) => Promise<unknown>;
  list: (worktree: string) => Promise<Draft[]>;
};
export const tauriIo: DraftIo = {
  set: (worktree, path, text, base) => invoke("editor_draft_set", { worktree, path, text, base }),
  clear: (worktree, path) => invoke("editor_draft_clear", { worktree, path }),
  list: (worktree) => invoke<Draft[]>("editor_drafts_get", { worktree }),
};

type Timers = { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const real: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export function createDrafts(io: DraftIo, ms = 600, timers: Timers = real) {
  const loaded = new Map<string, Promise<Map<string, Draft>>>();
  const timersOf = new Map<string, { t: unknown; worktree: string; path: string }>();
  const mirror = (worktree: string) => {
    const k = keyOf(worktree);
    let p = loaded.get(k);
    if (!p) loaded.set(k, (p = io.list(worktree).then((l) => new Map(l.map((d) => [keyOf(d.path), d] as const)), () => new Map<string, Draft>())));
    return p;
  };
  const pk = (worktree: string, path: string) => keyOf(worktree) + "\n" + keyOf(path);
  const stop = (k: string) => {
    const t = timersOf.get(k);
    if (t !== undefined) timers.clear(t.t);
    timersOf.delete(k);
  };
  /** Writes the draft for the file as it is now (or clears it when the tab is clean). */
  const flushOne = async (worktree: string, path: string) => {
    stop(pk(worktree, path));
    const m = await mirror(worktree);
    const text = textOf(path);
    if (text === null) return;
    if (!isDirty(path)) {
      if (m.delete(keyOf(path))) await io.clear(worktree, path).catch(() => undefined);
      return;
    }
    const base = await hashOf(diskOf(path) ?? "");
    m.set(keyOf(path), { path, text, base });
    await io.set(worktree, path, text, base).catch(() => undefined);
  };
  return {
    /** The draft kept for a file (null when none). */
    async take(worktree: string, path: string): Promise<Draft | null> {
      return (await mirror(worktree)).get(keyOf(path)) ?? null;
    },
    /** The tab's text changed: write the draft a moment after typing stops. Never for a read-only tab. */
    edited(worktree: string, path: string, readOnly = false) {
      if (readOnly) return;
      const k = pk(worktree, path);
      stop(k);
      timersOf.set(k, { t: timers.set(() => void flushOne(worktree, path), ms), worktree, path });
    },
    /** Writes a waiting draft at once (the window is closing, the tab is leaving). */
    flush: (worktree: string, path: string) => flushOne(worktree, path),
    /** Row 135: writes every waiting draft at once (the window lost focus, was hidden or is closing),
     *  so the last moment of typing is not missing from the draft. */
    flushAll: () => Promise.all([...timersOf.values()].map(({ worktree, path }) => flushOne(worktree, path))),
    /** The user closed the tab or chose to drop the edits: the draft goes. */
    async discard(worktree: string, path: string) {
      stop(pk(worktree, path));
      (await mirror(worktree)).delete(keyOf(path));
      await io.clear(worktree, path).catch(() => undefined);
    },
    pending: (worktree: string, path: string) => timersOf.has(pk(worktree, path)),
  };
}

/** The window's drafts. */
export const drafts = createDrafts(tauriIo);

/** Row 135: the waiting drafts are written when the window loses focus (a tray Quit takes the focus
 *  first), is hidden, or unloads; a close from the window itself asks first while a tab is unsaved. */
export function flushOnLeave(target: Pick<Window, "addEventListener" | "removeEventListener">, flushAll: () => unknown): () => void {
  const go = () => void flushAll();
  const hidden = () => {
    if (typeof document === "undefined" || document.visibilityState === "hidden") go();
  };
  target.addEventListener("blur", go);
  target.addEventListener("pagehide", go);
  target.addEventListener("visibilitychange", hidden);
  return () => {
    target.removeEventListener("blur", go);
    target.removeEventListener("pagehide", go);
    target.removeEventListener("visibilitychange", hidden);
  };
}
if (typeof window !== "undefined") flushOnLeave(window, drafts.flushAll);

/** The worktree a draft is kept under: the tab's worktree root, else the file's own folder. */
export const worktreeOf = (root: string | null | undefined, path: string): string => root ?? path.replace(/[\\/][^\\/]*$/, "");
