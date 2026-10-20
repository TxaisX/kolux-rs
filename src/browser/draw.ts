// BROW-038: drawing on a page screenshot. Pure rules: the shapes, undo and redo, how a capture is
// scaled to fit a pixel budget, and the one-time hint. The canvas itself waits for a page capture
// (the engine's capture is not reached in this build; see the T-241 PLAN line).

export type Tool = "rect" | "arrow" | "text";
export type Shape = { tool: Tool; x: number; y: number; w: number; h: number; text?: string };
export type Drawing = { shapes: Shape[]; undone: Shape[] };

export const empty = (): Drawing => ({ shapes: [], undone: [] });

/** A new shape drops whatever was undone (the usual editor rule). */
export const add = (d: Drawing, s: Shape): Drawing => ({ shapes: [...d.shapes, s], undone: [] });

export const undo = (d: Drawing): Drawing => (d.shapes.length ? { shapes: d.shapes.slice(0, -1), undone: [...d.undone, d.shapes[d.shapes.length - 1]] } : d);

export const redo = (d: Drawing): Drawing => (d.undone.length ? { shapes: [...d.shapes, d.undone[d.undone.length - 1]], undone: d.undone.slice(0, -1) } : d);

/** A drag in any direction becomes a box with a positive size; an arrow keeps its direction. */
export const normalise = (tool: Tool, x0: number, y0: number, x1: number, y1: number): Shape =>
  tool === "arrow" ? { tool, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { tool, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };

/** The most pixels a capture may hold (a 4K screen at scale 1 fits; a scale 2 one is halved). */
export const PIXEL_BUDGET = 16_000_000;

/** The capture scales to try, largest first: the display's own, then smaller, each within the budget and 1..4. */
export function sizes(width: number, height: number, scale: number): number[] {
  const out: number[] = [];
  for (let s = Math.min(4, Math.max(1, Math.round(scale))); s >= 1; s--) if (width * height * s * s <= PIXEL_BUDGET) out.push(s);
  return out.length ? out : [1];
}

export const HINT_KEY = "kolux-draw-hint-seen";

/** The first drawing shows how (drag a box, A for arrow, T for text); after that it stays quiet. */
export const hintSeen = (store: Pick<Storage, "getItem"> | null): boolean => {
  try {
    return store?.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
};

export const dismissHint = (store: Pick<Storage, "setItem"> | null): void => {
  try {
    store?.setItem(HINT_KEY, "1");
  } catch {
    /* a blocked store only means the hint shows again */
  }
};
