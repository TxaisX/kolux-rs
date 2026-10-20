// EDIT-003 / EDIT-032 (after-list row 131): unsaved text is never written over a disk copy that
// changed since it was typed. When that would happen without anyone asking (text carried by a move
// to a file that changed meanwhile), Kolux keeps both: the disk copy stays, and the unsaved text is
// written beside it as `<name>.unsaved-<time>`, a new file that never replaces one already there.
// Coordinator default; Txais may overrule.
import { invoke } from "@tauri-apps/api/core";

export type CopyIo = {
  exists(path: string): Promise<boolean>;
  write(path: string, text: string): Promise<void>;
};

const realIo: CopyIo = {
  exists: (p) => invoke<(unknown | null)[]>("file_stamps", { paths: [p] }).then((r) => (r?.[0] ?? null) !== null),
  write: (p, text) => invoke("file_write", { path: p, text }).then(() => undefined),
};

const two = (n: number) => String(n).padStart(2, "0");

/** `notes.md` at 2026-10-20 15:04:05 local time -> `notes.md.unsaved-20261020-150405`. */
export function copyPath(path: string, now: Date, n = 1): string {
  const at = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${path}.unsaved-${at}${n > 1 ? `-${n}` : ""}`;
}

/** Writes `text` to a free `<path>.unsaved-<time>` name beside the file and answers with it. A
 *  taken name is skipped, never overwritten. */
export async function keepUnsaved(path: string, text: string, io: CopyIo = realIo, now = new Date()): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const p = copyPath(path, now, n);
    if (await io.exists(p)) continue;
    await io.write(p, text);
    return p;
  }
  throw new Error("no free name for the copy");
}

/** The toast after the copy was written, or after it failed (the tab then keeps the text and a
 *  save asks before writing over the newer disk copy). */
export const keptToast = (name: string, kept: string | null, err?: unknown): string =>
  kept
    ? `${name} changed on disk after it was moved, so your unsaved text was kept as ${kept.split(/[\\/]/).pop()} beside it.`
    : `${name} changed on disk after it was moved; your unsaved text stays in the tab and was not saved over it (${String(err)}).`;
