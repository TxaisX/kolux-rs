// EDIT-054 / EDIT-031 (T-236-b, T-237-b): the first save of an untitled note. The note is a real, empty file at the
// worktree root (files.rs md_new); its first save asks for a name, which may hold folders. This is the order of
// the steps, so a failure at any point leaves the text where it was: the name is checked, folders are made, the
// text is written under the new name, and only then is the empty untitled file removed. The tab follows the file
// through the same move announcement as an explorer rename (fileMoved.ts), so its text and undo history stay.
import { checkName } from "./untitled";

export type FirstSaveIo = {
  /** Whether a file or folder is already at this full path. */
  exists(full: string): Promise<boolean>;
  /** Makes one folder; resolves when it is already there. */
  makeFolder(parent: string, name: string): Promise<void>;
  /** Writes the new file (no hash: the path is new). */
  write(full: string, text: string): Promise<void>;
  /** Removes the empty untitled file the note started as. */
  remove(full: string): Promise<void>;
};

export type FirstSave = { ok: true; path: string; same: boolean; note?: string } | { ok: false; error: string };

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** Saves an untitled note under the name typed. `same` (the suggested name) writes nothing: the caller saves in place. */
export async function firstSave(io: FirstSaveIo, root: string, oldPath: string, typed: string, text: string): Promise<FirstSave> {
  const c = checkName(typed, oldPath, root, () => false);
  if (!c.ok) return c;
  if (c.same) return { ok: true, path: c.path, same: true };
  const rel = c.path.slice(norm(root).length + 1);
  try {
    if (await io.exists(c.path)) return { ok: false, error: `${rel} already exists; choose another name.` };
    const parts = rel.split("/");
    let dir = norm(root);
    for (const folder of parts.slice(0, -1)) {
      await io.makeFolder(dir, folder);
      dir += "/" + folder;
    }
    await io.write(c.path, text);
  } catch (e) {
    return { ok: false, error: `${rel} was not saved: ${String(e)}` };
  }
  // The text is safe under its new name; a stuck leftover only costs an empty file.
  try {
    await io.remove(oldPath);
  } catch (e) {
    return { ok: true, path: c.path, same: false, note: `Saved as ${rel}, but the empty ${oldPath.split(/[\\/]/).pop()} could not be removed: ${String(e)}` };
  }
  return { ok: true, path: c.path, same: false };
}
