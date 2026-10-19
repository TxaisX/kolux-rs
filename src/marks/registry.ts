// T-335: the one table of vendor marks. Each entry names files in src/assets/vendors that came from
// the vendor's public brand kit (source, date, terms and a SHA-256 for each in NOTICE.md); nothing
// is redrawn here and nothing is fetched at run time (Txais, 2026-10-08). An id with no entry gets
// no vendor mark: AgentMark shows Kolux's neutral glyph and the name instead.
//
// `light` is the file shown on a light surface and `dark` the one for a dark surface. A vendor whose
// kit ships one coloured mark names the same file twice.

export type VendorMarkEntry = {
  /** Catalogue agent id (claude, codex, copilot) or tool id (github, linear, vscode). */
  id: string;
  /** The product the mark names, as the picture's text alternative. */
  name: string;
  /** Who owns the mark (for NOTICE and the settings credit line). */
  maker: string;
  light: string;
  dark: string;
};

export const VENDOR_MARKS: readonly VendorMarkEntry[] = [
  { id: "claude", name: "Claude", maker: "Anthropic", light: "anthropic-claude-spark.svg", dark: "anthropic-claude-spark.svg" },
  { id: "codex", name: "Codex", maker: "OpenAI", light: "openai-blossom-black.svg", dark: "openai-blossom-white.svg" },
  { id: "copilot", name: "GitHub Copilot", maker: "GitHub", light: "github-copilot-icon-black.svg", dark: "github-copilot-icon-white.svg" },
  { id: "github", name: "GitHub", maker: "GitHub", light: "github-invertocat-black.svg", dark: "github-invertocat-white.svg" },
  { id: "linear", name: "Linear", maker: "Linear", light: "linear-logo-dark.svg", dark: "linear-logo-light.svg" },
  { id: "vscode", name: "VS Code", maker: "Microsoft", light: "vscode-icon.svg", dark: "vscode-icon.svg" },
];

/** Where each kit file lives once built: Vite turns the glob into the bundled URL, so no path is typed by hand. */
const URLS = import.meta.glob("../assets/vendors/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** The bundled URL of a vendor file, or undefined when no such file ships. */
export function vendorUrl(file: string): string | undefined {
  return URLS[`../assets/vendors/${file}`];
}

/** Every file name that ships in the vendors folder. */
export function vendorFiles(): string[] {
  return Object.keys(URLS).map((k) => k.slice(k.lastIndexOf("/") + 1));
}

/** The mark for an agent or tool id, or null when the id has none (the caller then shows the neutral glyph). */
export function vendorMark(id: string): VendorMarkEntry | null {
  return VENDOR_MARKS.find((m) => m.id === id) ?? null;
}
