// SET-020: what the window chrome shows, kept in the settings file as booleans. DT-A6: the app name
// is off by default (DESIGN.md draws it nowhere) and the Automations button and the sidebar's Automations row (AUTO-023) stay on until the
// command palette gives Automations a second way in. One switch per item: `automationsButton` is
// both SET-020's Automations button and VIEW-011's title-bar button (title bar and sidebar alike).
import { readStatusBar, STATUS_ITEMS } from "./statusItems";

export const CHROME = [
  { id: "titleBarAppName", label: "Show app name in the title bar", short: "App name", dflt: false },
  { id: "tasksButton", label: "Show Tasks button", short: "Tasks", dflt: true },
  { id: "automationsButton", label: "Show Automations row in the sidebar", short: "Automations", dflt: true },
  // SKILL-018: hidden on a fresh install; this switch is the way to turn it on (SKILL-019 cut the Skills section).
  { id: "skillsButton", label: "Show Skills button in the sidebar", short: "Skills", dflt: false },
] as const;
export type ChromeItem = (typeof CHROME)[number]["id"];

export function chromeShown(s: Record<string, unknown>, id: ChromeItem): boolean {
  const v = s[id];
  return typeof v === "boolean" ? v : CHROME.find((c) => c.id === id)!.dflt;
}

export function windowSummary(s: Record<string, unknown>): string {
  const bar = readStatusBar(s);
  const shown = STATUS_ITEMS.length - bar.hidden.length;
  const status = !bar.visible ? "Status bar hidden" : shown < STATUS_ITEMS.length ? `Status bar, ${shown} of ${STATUS_ITEMS.length} items` : "Status bar";
  return [...CHROME.filter((c) => chromeShown(s, c.id)).map((c) => c.short), status].join(" · ");
}

// APP-009 / T-248-a: the native menu bar is a picture of what the page shows. The page sends this
// state to the menu on every change (screen, chrome switches, shortcuts), so the menu's ticks agree
// with each Settings switch (SET-020) and its accelerators follow the Shortcuts page (SET-009).
/** Menu items that carry the in-app shortcut of the keymap action with the same id. */
export const MENU_SHORTCUT_IDS = ["app.settings", "app.forceReload", "sidebar.left.toggle", "sidebar.right.toggle"] as const;

const MENU_KEY = /^([A-Z]|[0-9]|F([1-9]|1[0-9]|2[0-4])|Comma|Equal|Minus|Period|Slash|Backslash|BracketLeft|BracketRight|Semicolon|Quote|Backquote|Tab|Enter|Space|Arrow(Up|Down|Left|Right)|Numpad(Add|Subtract|Multiply|Divide|[0-9]))$/;
const MENU_MOD: Record<string, string> = { Mod: "CmdOrCtrl", Ctrl: "Ctrl", Cmd: "Super", Meta: "Super", Alt: "Alt", Shift: "Shift" };

/** A keymap chord ("Mod+Comma") in the menu's accelerator spelling ("CmdOrCtrl+Comma"); "" when the
 *  menu cannot show it (no chord, or a key the menu has no name for), so the item shows none. */
export function toAccelerator(chord: string | undefined): string {
  if (!chord) return "";
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  if (!MENU_KEY.test(key) || parts.some((m) => !MENU_MOD[m])) return "";
  return [...parts.map((m) => MENU_MOD[m]), key].join("+");
}

export type MenuBarState = { screen: string; statusBarVisible: boolean; tasksButton: boolean; automationsButton: boolean; titleBarAppName: boolean; classic: boolean; accelerators: Record<string, string> };

/** `chords(id)`: the keymap's chords for an action, first one shown (empty when unbound). `classic`:
 * the Classic look, whose View menu has no Workspace View (T-049-b). Zoom has no hint: Ctrl+= is the
 * terminal font zoom (TERM-078), while the menu's zoom is the saved interface zoom (SET-019). */
export function menuBarState(s: Record<string, unknown>, screen: string, chords: (id: string) => readonly string[] | undefined, classic = false): MenuBarState {
  return {
    screen,
    statusBarVisible: readStatusBar(s).visible,
    tasksButton: chromeShown(s, "tasksButton"),
    automationsButton: chromeShown(s, "automationsButton"),
    titleBarAppName: chromeShown(s, "titleBarAppName"),
    classic,
    accelerators: Object.fromEntries(MENU_SHORTCUT_IDS.map((id) => [id, toAccelerator(chords(id)?.[0])])),
  };
}

/** A menu tick box was clicked: the settings field it flips and the value to save, or null. */
/** APP-009 Edit on Windows and Linux: what an edit.* menu click does. A focused text field outside a
 * terminal takes the page's own command. Otherwise only Copy and Select All go to the focused
 * terminal, as calls and never as a key press, so a rebound chord or an empty selection can't reach the
 * agent; undo, redo and cut do nothing there. Paste waits for the core lane's attachPaste. */
export type MenuEdit = { field: "undo" | "redo" | "cut" | "copy" | "selectAll" } | { terminal: "copy" | "selectAll" } | null;
const EDIT_OPS = ["undo", "redo", "cut", "copy", "selectAll"] as const;
export function menuEdit(id: string, inField: boolean): MenuEdit {
  const op = EDIT_OPS.find((o) => id === "edit." + o);
  if (!op) return null;
  if (inField) return { field: op };
  return op === "copy" || op === "selectAll" ? { terminal: op } : null;
}

export function menuSettingFlip(s: Record<string, unknown>, id: string): [string, boolean] | null {
  if (id === "set.statusBarVisible") return ["statusBarVisible", !readStatusBar(s).visible];
  const item = CHROME.find((c) => `set.${c.id}` === id);
  return item ? [item.id, !chromeShown(s, item.id)] : null;
}

/** A Workspace View pick: the screen it shows, or null for any other item. */
export function menuScreen(id: string): "agents" | "board" | "terminals" | null {
  return id === "screen.agents" ? "agents" : id === "screen.board" ? "board" : id === "screen.terminals" ? "terminals" : null;
}
