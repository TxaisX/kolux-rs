// SET-015 (T-246-b): the arrangement of the tab-stepping keys. New installs get Mod+Shift+[ and ] for all
// tabs and Mod+Alt+[ and ] for tabs of the same kind (the defaults in actions.ts). An install that had a
// keybindings file before this arrangement keeps the reversed pairing it was used to, written into the file
// (SET-011) once; a file that already names any of the four commands is left alone, so this never repeats
// and never overrides a choice. Pure over the file's JSON.
export const OLD_PAIRING: Record<string, string[]> = {
  "tab.nextSameType": ["Mod+Shift+BracketRight"],
  "tab.previousSameType": ["Mod+Shift+BracketLeft"],
  "tab.nextAllTypes": ["Mod+Alt+BracketRight"],
  "tab.previousAllTypes": ["Mod+Alt+BracketLeft"],
};
export const TAB_STEP_IDS = Object.keys(OLD_PAIRING);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Does the file already say something about any of the four commands (any section)? */
function names(file: Record<string, unknown>): boolean {
  const sections = [file, file.keybindings, ...(isObject(file.platforms) ? Object.values(file.platforms) : [])];
  return sections.some((s) => isObject(s) && TAB_STEP_IDS.some((id) => id in s));
}

/**
 * The file to write for an upgrading install, or null when nothing changes. `existed` is whether a
 * keybindings file (or older shortcut settings) was there before; a new install passes false.
 */
export function seedOldTabPairing(file: unknown, existed: boolean): Record<string, unknown> | null {
  if (!existed) return null;
  const base: Record<string, unknown> = isObject(file) ? file : {};
  if (names(base)) return null;
  if ("keybindings" in base) {
    // A keybindings value that is not an object is left for the user to fix.
    return isObject(base.keybindings) ? { ...base, keybindings: { ...base.keybindings, ...OLD_PAIRING } } : null;
  }
  const older = Object.keys(base).some((k) => !["$schema", "version", "platforms"].includes(k));
  // The older form keeps ids at the top level; an empty or new-form file gets a keybindings section.
  return older ? { ...base, ...OLD_PAIRING } : { ...base, keybindings: { ...OLD_PAIRING } };
}
