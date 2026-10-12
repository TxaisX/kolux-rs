// SET-023 / TERM-098: the terminal scheme catalogue and the user's own schemes. Every palette here
// is a published, permissively licensed scheme (sources in PROVENANCE.md section 5, T-148-a).
// Custom schemes are pasted in the Windows Terminal scheme format and kept in the settings file.
import type { ITheme } from "@xterm/xterm";

export type Scheme = { id: string; name: string; light: boolean; colours: ITheme };
/** A user's scheme as saved: a name plus xterm colour keys. */
export type CustomScheme = ITheme & { name: string };

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const KEYS = ["background", "foreground", "cursor", "cursorAccent", "selectionBackground", ...ANSI, ...ANSI.map((c) => "bright" + c[0].toUpperCase() + c.slice(1))];

/** bg, fg, then the 16 colours in order black..white, brightBlack..brightWhite. */
function make(id: string, name: string, light: boolean, bg: string, fg: string, c: string): Scheme {
  const list = c.split(" ").map((h) => "#" + h);
  const colours: ITheme = { background: bg, foreground: fg, cursor: fg, cursorAccent: bg };
  KEYS.slice(5).forEach((k, i) => ((colours as Record<string, string>)[k] = list[i]));
  return { id, name, light, colours };
}

export const CATALOGUE: Scheme[] = [
  make("tango-light", "Tango Light", true, "#ffffff", "#2e3436", "2e3436 cc0000 4e9a06 c4a000 3465a4 75507b 06989a d3d7cf 555753 ef2929 8ae234 fce94f 729fcf ad7fa8 34e2e2 eeeeec"),
  make("tango-dark", "Tango Dark", false, "#000000", "#d3d7cf", "2e3436 cc0000 4e9a06 c4a000 3465a4 75507b 06989a d3d7cf 555753 ef2929 8ae234 fce94f 729fcf ad7fa8 34e2e2 eeeeec"),
  make("campbell", "Campbell", false, "#0c0c0c", "#cccccc", "0c0c0c c50f1f 13a10e c19c00 0037da 881798 3a96dd cccccc 767676 e74856 16c60c f9f1a5 3b78ff b4009e 61d6d6 f2f2f2"),
  make("solarized-dark", "Solarized Dark", false, "#002b36", "#839496", "073642 dc322f 859900 b58900 268bd2 d33682 2aa198 eee8d5 002b36 cb4b16 586e75 657b83 839496 6c71c4 93a1a1 fdf6e3"),
  make("solarized-light", "Solarized Light", true, "#fdf6e3", "#657b83", "073642 dc322f 859900 b58900 268bd2 d33682 2aa198 eee8d5 002b36 cb4b16 586e75 657b83 839496 6c71c4 93a1a1 fdf6e3"),
  make("dracula", "Dracula", false, "#282a36", "#f8f8f2", "21222c ff5555 50fa7b f1fa8c bd93f9 ff79c6 8be9fd f8f8f2 6272a4 ff6e6e 69ff94 ffffa5 d6acff ff92df a4ffff ffffff"),
  make("nord", "Nord", false, "#2e3440", "#d8dee9", "3b4252 bf616a a3be8c ebcb8b 81a1c1 b48ead 88c0d0 e5e9f0 4c566a bf616a a3be8c ebcb8b 81a1c1 b48ead 8fbcbb eceff4"),
  make("gruvbox-dark", "Gruvbox Dark", false, "#282828", "#ebdbb2", "282828 cc241d 98971a d79921 458588 b16286 689d6a a89984 928374 fb4934 b8bb26 fabd2f 83a598 d3869b 8ec07c ebdbb2"),
  make("gruvbox-light", "Gruvbox Light", true, "#fbf1c7", "#3c3836", "fbf1c7 cc241d 98971a d79921 458588 b16286 689d6a 7c6f64 928374 9d0006 79740e b57614 076678 8f3f71 427b58 3c3836"),
  make("one-half-dark", "One Half Dark", false, "#282c34", "#dcdfe4", "282c34 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 dcdfe4 282c34 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 dcdfe4"),
  make("one-half-light", "One Half Light", true, "#fafafa", "#383a42", "383a42 e45649 50a14f c18401 0184bc a626a4 0997b3 fafafa 383a42 e45649 50a14f c18401 0184bc a626a4 0997b3 fafafa"),
];

const squash = (t: string) => t.toLowerCase().replace(/\s+/g, "");
/** The catalogue narrowed to names holding what was typed (case and spaces ignored). */
export const findSchemes = <T extends { name: string }>(list: T[], query: string) => list.filter((s) => squash(s.name).includes(squash(query)));

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const ALIAS: Record<string, string> = { purple: "magenta", brightPurple: "brightMagenta", cursorColor: "cursor" };

/** One scheme cleaned up: a name and valid background and text colours, unknown or bad keys dropped. */
function tidy(raw: unknown): CustomScheme | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "That is not a scheme.";
  const out: Record<string, string> = {};
  for (const [k0, v] of Object.entries(raw as Record<string, unknown>)) {
    const k = ALIAS[k0] ?? k0;
    if (KEYS.includes(k) && typeof v === "string" && HEX.test(v.trim())) out[k] = v.trim().toLowerCase();
  }
  const name = (raw as { name?: unknown }).name;
  if (typeof name !== "string" || !name.trim()) return "The scheme needs a name.";
  if (!out.background || !out.foreground) return "The scheme needs a background and a foreground colour (#rrggbb).";
  return { name: name.trim(), ...out };
}

/** A pasted Windows Terminal scheme (the object from its "schemes" list). Throws with a reason. */
export function importScheme(text: string): CustomScheme {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That is not a scheme: paste one scheme from Windows Terminal's settings (an object with name, background, foreground and colours).");
  }
  const s = tidy(raw);
  if (typeof s === "string") throw new Error(s);
  return s;
}

/** The saved custom schemes, tidied when loaded: bad entries drop out and the first of a name wins. */
export function tidySchemes(saved: unknown): CustomScheme[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  return saved.flatMap((r) => {
    const s = tidy(r);
    if (typeof s === "string" || seen.has(s.name.toLowerCase())) return [];
    seen.add(s.name.toLowerCase());
    return [s];
  });
}
