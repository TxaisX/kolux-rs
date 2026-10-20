// PROJ-048: a workspace row dropped on the middle of another row becomes its child; the edges still reorder.
import { parentChoices, type Worktree } from "./model";

export type DropBand = "above" | "parent" | "below";

/** The top quarter of a row is "above", the bottom quarter "below", the middle half takes a parent drop. */
export function dropBand(offsetY: number, height: number): DropBand {
  if (!(height > 0)) return "below";
  const f = offsetY / height;
  return f < 0.25 ? "above" : f > 0.75 ? "below" : "parent";
}

const norm = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
const same = (a: string, b: string) => norm(a) === norm(b);

/**
 * The new parent for `dragged` when it is dropped on `target`'s middle band, else null (the drop
 * then reorders). Never itself, one of its own descendants (a loop), the main checkout, or the
 * parent it already has; those are the same rules as the Move to picker.
 */
export function parentDropTarget(all: Worktree[], dragged: string, target: string, band: DropBand): Worktree | null {
  if (band !== "parent") return null;
  const w = all.find((x) => same(x.path, dragged));
  if (!w || w.isMain) return null;
  return parentChoices(all, w).find((x) => same(x.path, target)) ?? null;
}
