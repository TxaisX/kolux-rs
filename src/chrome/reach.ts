// T-610 (brief "Path to an A", Phase 0): how the screens off the top bar's switcher are reached. A command
// that shows a screen toggles it with Terminals (the window's key switch reads SCREEN_OF, so a shortcut and
// its palette row do the same); Artifacts and Skills, which have no command, get palette rows of their own.
// The switcher keeps VIEW-002's four (Agents, Board, Terminals, Tower; its cycle order is a P0 rule).
import type { Screen } from "./TopBar";
import type { PaletteItem } from "../projects/WorktreePalette";

/** The commands that show a screen. Floor is reached from the palette, never the sidebar (VIEW-013, DT-08). */
export const SCREEN_OF: Readonly<Record<string, Screen>> = { "view.inbox": "inbox", "view.tower": "tower", "view.floor": "floor", "view.space": "space" };

/** Palette rows for the screens no command shows (the sidebar's Artifacts and Skills buttons open them too). */
export function screenRows(go: (s: Screen) => void): PaletteItem[] {
  return [
    { section: "Commands", label: "Show Artifacts", run: () => go("artifacts") },
    { section: "Commands", label: "Show Skills", run: () => go("skills") },
  ];
}
