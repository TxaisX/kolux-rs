// EDIT-032 (T-177): renaming or moving a file (or a folder holding open files) keeps its tab and
// its unsaved edits. Explorer calls `announceMoves` after the move succeeded on disk (a move that
// ran into a taken name never reaches here, so its tab stays on the old path). The unsaved text is
// carried to the new path, autosave holds off the new path until its tab has read the file there,
// and App (which owns the tab list) is told through a window event to point the tabs at the new
// paths.
import { carryOver, keyOf } from "./buffers";
import { beginMove, endMove } from "./autosave";

export type Move = [from: string, to: string];
export const MOVED_EVENT = "kolux-files-moved";

/** Where a path ends up after the moves (a folder move takes what is under it); null when untouched. */
export function movedPath(path: string, moves: Move[]): string | null {
  const k = keyOf(path);
  for (const [from, to] of moves) {
    const f = keyOf(from);
    if (k === f) return to;
    if (k.startsWith(f + "/")) return to.replace(/[\\/]+$/, "") + path.slice(f.length);
  }
  return null;
}

/** A tab that waits for its file at the new path holds autosave off until `confirmed` (or this long). */
export const HOLD_MS = 10000;

/** Called once per successful move. Returns the paths whose tabs must hold autosave until they have
 *  read the file at its new place (each tab then calls `confirmed`). */
export function announceMoves(moves: Move[], target: EventTarget | null = typeof window === "undefined" ? null : window): string[] {
  if (!moves.length) return [];
  const carried = carryOver(moves);
  carried.forEach((k) => {
    beginMove(k);
    setTimeout(() => endMove(k), HOLD_MS);
  });
  target?.dispatchEvent(new CustomEvent(MOVED_EVENT, { detail: moves }));
  return carried;
}

/** The tab read its file at the new path: autosave may write again. */
export const confirmed = (path: string): void => endMove(path);
