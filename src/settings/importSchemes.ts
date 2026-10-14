// SET-024 (T-323): bring terminal schemes in from a Warp theme file (YAML) or a Ghostty
// configuration (COMPAT: both stay sources). Each file becomes Windows Terminal-shaped keys that the
// SET-023 tidy step checks, so a scheme brought in here is held to the same rules as a pasted one.
// Formats from the public docs: Warp's custom themes page and Ghostty's configuration reference.
import type { ITheme } from "@xterm/xterm";
import { importScheme, type CustomScheme } from "../terminal/schemes";

/** How many custom schemes a profile keeps. Replacing one already there is allowed at the cap. */
export const MAX_CUSTOM = 40;

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const bright = (c: string) => "bright" + c[0].toUpperCase() + c.slice(1);
const hex = (v: string) => {
  const t = v.trim().replace(/^['"]|['"]$/g, "");
  return /^[0-9a-f]{6}$/i.test(t) ? "#" + t : t;
};
/** The file name without folder or extension, as a scheme name when the file names none. */
export const stem = (file: string) => file.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "").replace(/[_-]+/g, " ").trim();

/** A small YAML reader for the shape Warp themes use: nested `key: value` maps, two-space indents. */
function yamlMap(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; map: Record<string, unknown> }> = [{ indent: -1, map: root }];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#") || line.trim() === "---") continue;
    const m = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) throw new Error("bad line");
    const indent = m[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].map;
    if (m[3] === "") {
      const child: Record<string, unknown> = {};
      parent[m[2]] = child;
      stack.push({ indent, map: child });
    } else parent[m[2]] = m[3].trim().replace(/^['"]|['"]$/g, "");
  }
  return root;
}

const NOT_WARP = "That is not a Warp theme: it needs background, foreground and terminal_colors with normal and bright colours.";

/** A Warp theme file. Throws with a reason the user can read. */
export function parseWarp(text: string, file = "Warp theme"): CustomScheme {
  let y: Record<string, unknown>;
  try {
    y = yamlMap(text);
  } catch {
    throw new Error(NOT_WARP);
  }
  const colours = y.terminal_colors as Record<string, Record<string, string>> | undefined;
  if (typeof y.background !== "string" || typeof y.foreground !== "string" || !colours?.normal || !colours?.bright) throw new Error(NOT_WARP);
  const out: Record<string, string> = { name: typeof y.name === "string" && y.name.trim() ? y.name : stem(file), background: hex(y.background), foreground: hex(y.foreground) };
  if (typeof y.accent === "string") out.cursor = hex(y.accent);
  for (const c of ANSI) {
    if (typeof colours.normal[c] === "string") out[c] = hex(colours.normal[c]);
    if (typeof colours.bright[c] === "string") out[bright(c)] = hex(colours.bright[c]);
  }
  return importScheme(JSON.stringify(out));
}

const GHOSTTY: Record<string, string> = { background: "background", foreground: "foreground", "cursor-color": "cursor", "cursor-text": "cursorAccent", "selection-background": "selectionBackground" };

/** The colours in a Ghostty configuration (`key = value` lines, `palette = N=#rrggbb`). */
export function parseGhostty(text: string, name = "Ghostty"): CustomScheme {
  const out: Record<string, string> = { name };
  let theme = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-z-]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "theme") theme = value.trim();
    else if (GHOSTTY[key]) out[GHOSTTY[key]] = hex(value);
    else if (key === "palette") {
      const p = /^(\d+)\s*=\s*(.+)$/.exec(value.trim());
      const n = p ? Number(p[1]) : -1;
      if (n >= 0 && n < 16) out[n < 8 ? ANSI[n] : bright(ANSI[n - 8])] = hex(p![2]);
    }
  }
  if (!out.background && !out.foreground && theme) throw new Error(`This configuration uses Ghostty's built-in theme "${theme}" and sets no colours of its own, so there is nothing to bring in.`);
  try {
    return importScheme(JSON.stringify(out));
  } catch {
    throw new Error("That is not a Ghostty configuration with colours: it needs background and foreground lines.");
  }
}

/** Picks one parser by what the file looks like: Warp files are YAML maps, Ghostty uses `=`. */
export function parseSchemeFile(file: string, text: string): CustomScheme {
  if (/\.ya?ml$/i.test(file) || /^\s*[A-Za-z_]+:/m.test(text)) return parseWarp(text, file);
  return parseGhostty(text, stem(file) && !/^config$/i.test(stem(file)) ? stem(file) : "Ghostty");
}

/** True when every colour the scheme sets is already what the terminal draws. */
export function sameColours(s: CustomScheme, now: ITheme): boolean {
  return Object.entries(s).every(([k, v]) => k === "name" || (now as Record<string, unknown>)[k]?.toString().toLowerCase() === v);
}

export type ImportPlan = { custom: CustomScheme[]; added: string[]; replaced: string[]; refused: string[] };

/** The ticked schemes merged into the saved list: a name already there is replaced in place (even
 *  at the cap), a new one is added while there is room, the rest are refused by name. */
export function planImport(saved: CustomScheme[], ticked: CustomScheme[], cap = MAX_CUSTOM): ImportPlan {
  const custom = [...saved];
  const plan: ImportPlan = { custom, added: [], replaced: [], refused: [] };
  for (const s of ticked) {
    const at = custom.findIndex((c) => c.name.toLowerCase() === s.name.toLowerCase());
    if (at >= 0) {
      custom[at] = s;
      plan.replaced.push(s.name);
    } else if (custom.length < cap) {
      custom.push(s);
      plan.added.push(s.name);
    } else plan.refused.push(s.name);
  }
  return plan;
}

/** What the result line says after applying. */
export function planSummary(p: ImportPlan, cap = MAX_CUSTOM): string {
  const parts = [p.added.length && `Added ${p.added.join(", ")}.`, p.replaced.length && `Replaced ${p.replaced.join(", ")}.`, p.refused.length && `Not added: ${p.refused.join(", ")}, because you already have ${cap} custom schemes. Remove one first.`];
  return parts.filter(Boolean).join(" ") || "Nothing was ticked, so nothing changed.";
}
