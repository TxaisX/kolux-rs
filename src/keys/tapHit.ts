// SET-009 (T-246-d): the window's key handler asks this on every keydown. A completed double tap of a
// modifier answers the command bound to it ("Double+Shift" in the keybindings file), else null, so the
// handler goes on to its ordinary chord match. Only commands that make sense anywhere in the window
// (global, tabs, terminal) can hold a double tap.
import type { Scope } from "./actions";
import { actionForTap, createDoubleTap } from "./doubleTap";
import type { Keymap, Match } from "./keymap";

const SCOPES: Scope[] = ["global", "tabs", "terminal"];
type Down = Parameters<ReturnType<typeof createDoubleTap>["down"]>[0] & { timeStamp?: number };

/** `now` defaults to the event's own time stamp (a high resolution clock in a browser). */
export function tapHit(matcher: ReturnType<typeof createDoubleTap>, map: Keymap, e: Down, now: number = e.timeStamp ?? Date.now()): Match | null {
  const tap = matcher.down(e, now);
  if (!tap) return null;
  const bound = [...map.bindings.values()].filter((b) => SCOPES.includes(b.action.scope)).map((b) => ({ id: b.action.id, chords: b.chords }));
  const id = actionForTap(bound, tap);
  return id ? { id } : null;
}

/** The window's one matcher: it must outlive the key handler's effect, which is set up again as panes change. */
export const windowTaps = createDoubleTap();
