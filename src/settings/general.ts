// SET-037: the Classic or New look and the workspace screen that opens first. Both live in General.
import type { Screen } from "../chrome/TopBar";

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

/** The screen the window opens on: under Classic always Terminals. */
export const startScreen = (s: Record<string, unknown>): Screen => (readLook(s) === "classic" ? "terminals" : savedFirst(s));
