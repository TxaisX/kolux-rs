// SET-037: the Classic or New look and the workspace screen that opens first. Both live in General.
import type { Screen } from "../chrome/TopBar";
import type { Page } from "../projects/ProjectsPanel";

export type Look = "classic" | "new";
export const LOOK_FIELD = "uiLook";
export const FIRST_FIELD = "firstScreen";

/** A profile that already had settings before this choice existed stays Classic until the user
 *  picks New; a fresh profile (no settings yet) starts New. */
export function readLook(s: Record<string, unknown>): Look {
  const v = s[LOOK_FIELD];
  if (v === "classic" || v === "new") return v;
  return Object.keys(s).length === 0 ? "new" : "classic";
}

/** The settings with the look written down, so a fresh profile stays New once other fields are saved. */
export const stampLook = (s: Record<string, unknown>): Record<string, unknown> | null => (s[LOOK_FIELD] === "classic" || s[LOOK_FIELD] === "new" ? null : { ...s, [LOOK_FIELD]: readLook(s) });

/** The saved first screen (Terminals when unset or unknown). */
export function savedFirst(s: Record<string, unknown>): Screen {
  const v = s[FIRST_FIELD];
  return v === "agents" || v === "board" ? v : "terminals";
}

/** VIEW-005: the screen in front at quit. Picking a first screen in General writes it too, so the
 *  next start honours that choice; after that the screen the user left wins. */
export const LAST_SCREEN_FIELD = "lastScreen";

/** The screen the window opens on: the one left at quit (Agents and Board only under New), else the
 *  first-screen choice under New, else Terminals; an unknown saved value counts as none. */
export function startScreen(s: Record<string, unknown>): Screen {
  const classic = readLook(s) === "classic";
  const last = s[LAST_SCREEN_FIELD];
  if (last === "terminals" || last === "artifacts" || last === "inbox") return last;
  if (last === "agents" || last === "board") return classic ? "terminals" : last;
  return classic ? "terminals" : savedFirst(s);
}

/** VIEW-005: a burst of changes is written once, `ms` after the last; `flush` writes a pending one
 *  at once (the window closing). */
export function lastWriter<T>(write: (v: T) => void, ms = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    write(pending);
  };
  const set = (v: T) => {
    pending = v;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, ms);
  };
  return { set, flush };
}


/** VIEW-011: the page that was open at quit, shown again at start (none when unset or unknown). */
export const OPEN_PAGE_FIELD = "openPage";
export function openPageAt(s: Record<string, unknown>): Page | null {
  const v = s[OPEN_PAGE_FIELD];
  return v === "automations" || v === "routing" || v === "tasks" ? v : null;
}
