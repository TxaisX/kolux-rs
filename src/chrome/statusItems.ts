// VIEW-096: which status bar items show, kept in the settings file. `statusBarVisible` shows or
// hides the whole bar; `statusBarHidden` lists the items the user unticked.

export const STATUS_ITEMS = [
  { id: "hooks", label: "Agent status" },
  { id: "memory", label: "Resource Manager" },
  { id: "terminals", label: "Terminals running" },
  { id: "agents", label: "Agents running" },
] as const;
export type StatusItem = (typeof STATUS_ITEMS)[number]["id"];
export const FIELDS = { visible: "statusBarVisible", hidden: "statusBarHidden" } as const;

/** An older saved list keeps the items this version still has; retired or unknown ids drop out. */
export function readStatusBar(s: Record<string, unknown>): { visible: boolean; hidden: string[] } {
  const raw = s[FIELDS.hidden];
  const known = new Set<string>(STATUS_ITEMS.map((i) => i.id));
  const hidden = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string" && known.has(x)))] : [];
  return { visible: s[FIELDS.visible] !== false, hidden };
}

export const toggleItem = (hidden: string[], id: string) => (hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
