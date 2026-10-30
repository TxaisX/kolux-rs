// EDIT-026 (T-317): a log tab that keeps adding lines as the file grows. A partly written last line is held
// back until its newline arrives; if the file was emptied, rotated or cut short, the view starts again from the top.

/** What the tab should show next given what it shows now and the file's text, or null when nothing changed.
 * `reset`: the file no longer continues what was shown, so the view starts over (the caller scrolls to the end). */
export function followStep(shown: string, disk: string): { text: string; reset: boolean } | null {
  const whole = disk.slice(0, disk.lastIndexOf("\n") + 1);
  if (whole === shown) return null;
  return { text: whole, reset: !whole.startsWith(shown) };
}

/** What a follow tick reads and changes; EditorPane passes the file commands and buffer calls, the tests fakes. */
export type FollowIo = { stamp: () => Promise<string>; read: () => Promise<string>; dirty: () => boolean; shown: () => string; show: (next: { text: string; reset: boolean }) => void };

/** One tick of a followed log (once a second): the file is read only when its stamp is not `last`, the stamp of the copy
 * shown; returns the stamp now shown. T-317 (EDIT-003): a plain tab of the same file shares the buffer (EDIT-001), so
 * while it holds unsaved edits the tick waits, looked at again after the read as typing can start meanwhile, and keeps
 * `last` so the next second tries again; the edits' own tab raises the disk banner. */
export async function followTick(last: string, io: FollowIo): Promise<string> {
  const st = await io.stamp();
  if (st === last || io.dirty()) return last;
  const disk = await io.read();
  if (io.dirty()) return last;
  const next = followStep(io.shown(), disk);
  if (next) io.show(next);
  return st;
}

/** T-317: the files the Explorer row menu offers to follow (Follow log): a name ending in .log, in any letter case.
 * ponytail: .log names only; widen this test if other growing files (a .jsonl transcript) need following. */
export const isLog = (path: string): boolean => /\.log$/i.test(path);
