// T-267 / TERM-102: the ligatures half. The @xterm/addon-ligatures package is an approved
// dependency on main since MERGE 240, so the pane imports it by its literal name and vite bundles
// it (the variable specifier used while the package was held left the browser a bare name it
// could not resolve, so ligatures never drew). The rule for when they are on (a saved on/off wins,
// automatic follows known ligature fonts) stays in terminal/inputPrefs.ts ligaturesOn.
// In a webview the addon cannot read the font file, so it joins the common programming ligatures
// from its own fallback list (arrows, comparisons, comment marks) and turns on the font's "calt".
export type LigaturesModule = typeof import("@xterm/addon-ligatures");

/** Load the approved addon package (one shared chunk for every pane). */
export const importLigatures = (): Promise<LigaturesModule> => import("@xterm/addon-ligatures");

/** After the addon joins or releases characters, a GPU pane must throw its glyph cache away so the
 *  joined arrows (or the plain ones again) are drawn; the plain renderer redraws by itself. */
export function afterLigatures(renderer: { clearGlyphs(): void }, term: { refresh(start: number, end: number): void; rows: number }): void {
  try {
    renderer.clearGlyphs();
  } catch {
    /* a lost GPU context falls back to plain drawing elsewhere */
  }
  term.refresh(0, Math.max(0, term.rows - 1));
}
