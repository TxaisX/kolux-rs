// SET-010: chords macOS itself grabs before an app sees them (Mission Control desktop switching).
// The web view cannot read whether the user turned those shortcuts on, so every such chord is flagged as "may".
import type { Platform } from "./actions";
import { parseChord } from "./keymap";

const ARROWS = new Set(["Left", "Right", "Up", "Down"].map((k) => `Arrow${k}`));

/** Ctrl+1 to Ctrl+9 (switch to desktop N) and Ctrl+arrows (Mission Control, App Exposé, switch desktop) on macOS. */
export function systemCapturedChord(chord: string, platform: Platform): boolean {
  if (platform !== "darwin") return false;
  const c = parseChord(chord);
  if ("error" in c || !c.ctrl || c.mod || c.meta || c.alt || c.shift) return false;
  return /^[1-9]$/.test(c.key) || ARROWS.has(c.key);
}

/** The text under a Shortcuts row whose chord macOS may take before Kolux sees it. */
export const systemCaptureWarning = (label: string): string =>
  `${label} may be captured by macOS (Mission Control desktop switching) before Kolux sees it. Turn that shortcut off in System Settings > Keyboard > Keyboard Shortcuts > Mission Control, or give this command other keys.`;
