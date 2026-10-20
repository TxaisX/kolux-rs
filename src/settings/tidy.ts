// SET-035 (T-181): saved values are tidied when settings load and again before they are saved, so a
// hand-edited file or an older format never reaches a page as nonsense. Only keys that are present
// are touched; a missing key stays missing (the page's own default applies).
import { tidySchemes } from "../terminal/schemes";
import { clampNumber, FIELDS, LINE_HEIGHT, SCROLLBACK } from "../terminal/text";
import { BYPASS_FIELD } from "./proxy";

type Settings = Record<string, unknown>;

/** The three app icons Kolux ships (SET-041); an unknown stored value means the first. */
export const APP_ICONS = ["classic", "watercolor", "blue"] as const;
export const APP_ICON_FIELD = "appIcon";

/** The proxy bypass list as a clean list: lower case, no repeats, entries that are not hosts,
 * addresses or ranges dropped. An older release kept it as one comma or space separated string. */
export function tidyBypassList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : typeof v === "string" ? v.split(/[\s,;]+/) : [];
  const entry = /^(\*\.|\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$|^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$|^<local>$|^\*$/;
  const out: string[] = [];
  for (const e of raw.map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (entry.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

/** `settings` with its terminal scrollback rows, line height, custom schemes, proxy bypass list and
 * app icon tidied. Returns the same object when nothing needed changing. */
export function tidySettings(settings: Settings): Settings {
  const next: Settings = { ...settings };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const has = (k: string) => k in settings && settings[k] !== undefined && settings[k] !== null;
  if (has(FIELDS.scrollback)) next[FIELDS.scrollback] = clampNumber(settings[FIELDS.scrollback], SCROLLBACK.min, SCROLLBACK.max, SCROLLBACK.start);
  if (has(FIELDS.lineHeight)) next[FIELDS.lineHeight] = clampNumber(settings[FIELDS.lineHeight], LINE_HEIGHT.min, LINE_HEIGHT.max, LINE_HEIGHT.start, 0.05);
  if (has("terminalCustomSchemes")) next.terminalCustomSchemes = tidySchemes(settings.terminalCustomSchemes);
  if (has(BYPASS_FIELD)) next[BYPASS_FIELD] = tidyBypassList(settings[BYPASS_FIELD]);
  if (has(APP_ICON_FIELD)) {
    const v = settings[APP_ICON_FIELD];
    next[APP_ICON_FIELD] = typeof v === "string" && (APP_ICONS as readonly string[]).includes(v.toLowerCase()) ? v.toLowerCase() : APP_ICONS[0];
  }
  return Object.keys(next).every((k) => same(next[k], settings[k])) ? settings : next;
}
