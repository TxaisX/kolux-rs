// VIEW-113: what a Markdown file remembers about how it is shown: the contents panel open or shut, its width, and whether the
// front matter is hidden. Kept per file in this browser profile; a missing, broken or out-of-range value reads as the default.
export type MdPrefs = { toc: boolean; tocWidth: number; hideFront: boolean };

/** The contents panel's width limits and its start width (px). */
export const TOC_WIDTH = { min: 160, max: 420, start: 230 };

export const DEFAULT_PREFS: MdPrefs = { toc: false, tocWidth: TOC_WIDTH.start, hideFront: false };

/** A dragged width held between the limits; anything that is not a number is the start width. */
export function clampTocWidth(w: unknown): number {
  const n = typeof w === "number" ? w : Number.NaN;
  if (!Number.isFinite(n)) return TOC_WIDTH.start;
  return Math.min(TOC_WIDTH.max, Math.max(TOC_WIDTH.min, Math.round(n)));
}

const KEY = "mdViewPrefs";
type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

function readAll(s: Store | null): Record<string, Partial<MdPrefs>> {
  try {
    const v = JSON.parse(s?.getItem(KEY) ?? "{}");
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The saved choices for a file, every field corrected. */
export function mdPrefs(path: string, s: Store | null = store()): MdPrefs {
  const o = readAll(s)[norm(path)] ?? {};
  return { toc: o.toc === true, tocWidth: clampTocWidth(o.tocWidth), hideFront: o.hideFront === true };
}

/** Save some of a file's choices; the others stay as they were. */
export function setMdPrefs(path: string, patch: Partial<MdPrefs>, s: Store | null = store()): MdPrefs {
  const next = { ...mdPrefs(path, s), ...patch };
  next.tocWidth = clampTocWidth(next.tocWidth);
  try {
    s?.setItem(KEY, JSON.stringify({ ...readAll(s), [norm(path)]: next }));
  } catch {
    /* storage refused: the choice lasts until the tab closes */
  }
  return next;
}
