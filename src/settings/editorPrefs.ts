// SET-038 (T-323): editor and diff preferences, set in Settings > General. The built-in editor and
// the diff views read them through readEditorPrefs; editor word wrap and diff word wrap are separate.
export const EDITOR_FIELDS = {
  autoSave: "editorAutoSave",
  autoSaveDelay: "editorAutoSaveDelay",
  minimap: "editorMinimap",
  wordWrap: "editorWordWrap",
  spellcheck: "markdownSpellcheck",
  diffView: "diffView",
  diffWordWrap: "diffWordWrap",
  diffWhitespace: "diffShowWhitespace",
  diffTree: "diffFileTree",
} as const;

export type DiffView = "inline" | "split";
export type EditorPrefs = { autoSave: boolean; autoSaveDelay: number; minimap: boolean; wordWrap: boolean; spellcheck: boolean; diffView: DiffView; diffWordWrap: boolean; diffWhitespace: boolean; diffTree: boolean };

/** The auto-save delay range, in milliseconds. */
export const DELAY = { min: 200, max: 10000, base: 1000 } as const;

const flag = (v: unknown, base: boolean) => (typeof v === "boolean" ? v : base);
export const clampDelay = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(DELAY.max, Math.max(DELAY.min, v))) : DELAY.base);

/** Defaults: auto-save off (1000 ms once on), minimap off, word wrap on, spellcheck on; diffs inline,
 *  no word wrap, whitespace changes hidden, the combined diff's file tree hidden. */
export function readEditorPrefs(s: Record<string, unknown>): EditorPrefs {
  const F = EDITOR_FIELDS;
  return {
    autoSave: flag(s[F.autoSave], false),
    autoSaveDelay: clampDelay(s[F.autoSaveDelay]),
    minimap: flag(s[F.minimap], false),
    wordWrap: flag(s[F.wordWrap], true),
    spellcheck: flag(s[F.spellcheck], true),
    diffView: s[F.diffView] === "split" ? "split" : "inline",
    diffWordWrap: flag(s[F.diffWordWrap], false),
    diffWhitespace: flag(s[F.diffWhitespace], false),
    diffTree: flag(s[F.diffTree], false),
  };
}

/** A patch that changes one preference only, so the editor and diff word wraps never move together. */
export const prefPatch = <K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]) => ({ [EDITOR_FIELDS[key]]: key === "autoSaveDelay" ? clampDelay(value) : value });

/** A changed line pair the diff hides while whitespace display is off: only spaces or tabs moved. */
export const hiddenWhitespace = (before: string, after: string, show: boolean) => !show && before !== after && before.replace(/\s+/g, "") === after.replace(/\s+/g, "");

/** Auto-save: each edit restarts the wait; the file is written `delay` ms after typing stops.
 *  Returns null when auto-save is off. `flush` writes a pending save at once (closing the file). */
export function autoSaver(prefs: EditorPrefs, write: () => void): { edit: () => void; flush: () => void } | null {
  if (!prefs.autoSave) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    write();
  };
  return {
    edit: () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, prefs.autoSaveDelay);
    },
    flush,
  };
}
