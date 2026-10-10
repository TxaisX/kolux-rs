// The Classic theme: the neutral palette measured in design/DESIGN.md section 2, as named tokens.
// They become CSS custom properties on the document root (styles.css reads them as var(--name))
// and feed the terminal theme, so every colour has one home. The 16 hued themes come with SET-001.

export const classic = {
  // surfaces and lines
  "app-bg": "#050405",
  "strip-bg": "#0a0a0a",
  "pane-bg": "#0d0d0d",
  "input-bg": "#0f0f0f",
  surface: "#171717",
  "chip-bg": "#1d1d1d",
  "kbd-bg": "#1f1f1f",
  "kbd-border": "#2c2c2c",
  "line-subtle": "#1b1b1b",
  "line-inner": "#161616",
  line: "#212121",
  "line-strong": "#272727",
  "line-focus": "#2f2f2f",
  "tab-track": "#232223",
  "tab-track-border": "#2e2d2e",
  "row-selected": "#262626",
  "button-border": "#232323",
  "seg-active": "#404040",
  "gauge-track": "#1e1e1e",
  // text
  fg: "#fafafa",
  "fg-row": "#d8d7d8",
  "fg-muted": "#a1a1a1",
  "fg-nav": "#9f9f9f",
  "fg-label": "#868686",
  "fg-faint": "#7e7d7e",
  "fg-icon-dim": "#565656",
  "fg-disabled": "#4a4a4a",
  mark: "#c5c5c5",
  // status
  working: "#03cce9",
  "working-icon": "#eeb000",
  done: "#01c88f",
  "done-icon": "#039567",
  "dot-live": "#00bb80",
  "dot-idle": "#3c3c3c",
  link: "#b2baf6", // links in markdown documents (DESIGN.md terminal colours)
  gauge: "#8beeb0",
  "gauge-text": "#83e4a6",
} as const;

export type Theme = Record<keyof typeof classic, string>;

/** The ten colours the whole chrome is built from; the test checks them against DESIGN.md. */
export const coreTokens = ["app-bg", "strip-bg", "pane-bg", "input-bg", "surface", "line-subtle", "line-strong", "line-focus", "fg", "fg-muted"] as const;

// System font stacks: no font files are bundled (Inter and Cascadia are OFL, which LOOP.md's license
// list does not include); the first installed face wins, Segoe UI on a plain Windows install.
export const uiFont = 'Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
export const monoFont = '"Cascadia Mono", Consolas, monospace';

type StyleHost = { style: { setProperty(name: string, value: string): void } };

/** Writes every token as `--name` on the element (normally the document root). */
export function applyTheme(el: StyleHost, theme: Theme = classic): void {
  for (const [name, value] of Object.entries(theme)) el.style.setProperty(`--${name}`, value);
  el.style.setProperty("--ui-font", uiFont);
  el.style.setProperty("--mono-font", monoFont);
}

/** The terminal's colours, taken from the same tokens so the body matches the pane around it. */
export function terminalTheme(theme: Theme = classic) {
  return { background: theme["pane-bg"], foreground: theme.fg, cursor: theme.fg, cursorAccent: theme["pane-bg"] };
}
