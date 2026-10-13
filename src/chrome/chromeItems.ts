// SET-020: what the window chrome shows, kept in the settings file as booleans. DT-A6: the app name
// is off by default (DESIGN.md draws it nowhere) and the Automations button stays on until the
// command palette gives Automations a second way in. One switch per item: `automationsButton` is
// both SET-020's Automations button and VIEW-011's title-bar button (title bar and sidebar alike).
import { readStatusBar, STATUS_ITEMS } from "./statusItems";

export const CHROME = [
  { id: "titleBarAppName", label: "Show app name in the title bar", short: "App name", dflt: false },
  { id: "tasksButton", label: "Show Tasks button", short: "Tasks", dflt: true },
  { id: "automationsButton", label: "Show Automations button", short: "Automations", dflt: true },
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
