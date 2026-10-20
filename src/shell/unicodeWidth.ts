// T-308 / TERM-104: our own Unicode width provider for xterm (no addon). xterm ships only a
// Unicode 6 width table, so newer emoji and CJK characters came out one cell wide and pushed the
// right edge of a table out of line. This provider answers from Unicode 16.0.0 data
// (unicodeWidthData.ts, generated from unicode.org files) and joins the common emoji sequences
// (ZWJ families, VS16, skin tones, flags, keycaps) and Hangul syllable jamo into one cell group,
// so the cursor lands right after the whole character.
// Not built here: Arabic shaping (the font and the renderer do it; a cell grid cannot).
import type { IUnicodeVersionProvider } from "@xterm/xterm";
import { DOUBLE_WIDTH, PICTOGRAPHIC, UNICODE_VERSION, ZERO_WIDTH } from "./unicodeWidthData";

export const KOLUX_UNICODE = `kolux-${UNICODE_VERSION}`;

/** True when cp falls in one of the flat [first, last, ...] runs (binary search). */
export function inRuns(runs: readonly number[], cp: number): boolean {
  if (runs.length === 0 || cp < runs[0] || cp > runs[runs.length - 1]) return false;
  let lo = 0;
  let hi = runs.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < runs[mid * 2]) hi = mid - 1;
    else if (cp > runs[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

// Latin-1 and the ASCII range are asked for most; answer them without a search.
const fast = new Uint8Array(256);
for (let c = 0; c < 256; c++) fast[c] = c < 0x20 || (c >= 0x7f && c < 0xa0) ? 0 : inRuns(ZERO_WIDTH, c) ? 0 : 1;

/** Cells one code point takes on its own: 0, 1 or 2. Controls take none (xterm handles them). */
export function cellWidth(cp: number): 0 | 1 | 2 {
  if (cp < 256) return fast[cp] as 0 | 1;
  if (inRuns(ZERO_WIDTH, cp)) return 0;
  return inRuns(DOUBLE_WIDTH, cp) ? 2 : 1;
}

const ZWJ = 0x200d;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const isRegional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isSkinTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff;
const isPictographic = (cp: number) => inRuns(PICTOGRAPHIC, cp);

// What the last code point of the current group was, kept in the packed value's "kind" bits.
export const KIND = { plain: 0, zwj: 1, regional: 2, emoji: 3 } as const;
type Kind = (typeof KIND)[keyof typeof KIND];

/** xterm's packed character properties: kind << 3 | width << 1 | joins-the-previous-character. */
export const pack = (kind: Kind, width: number, join: boolean) => ((kind & 0xffffff) << 3) | ((width & 3) << 1) | (join ? 1 : 0);
export const widthOf = (props: number) => (props >> 1) & 3;
export const joins = (props: number) => (props & 1) !== 0;
export const kindOf = (props: number) => props >> 3;

/** One code point given the group before it (0 = start of text). When it joins, the width is the
 *  whole group's width, as xterm expects. */
export function charProps(cp: number, preceding: number): number {
  const width = cellWidth(cp);
  const ownKind: Kind = isRegional(cp) ? KIND.regional : isPictographic(cp) ? KIND.emoji : KIND.plain;
  if (preceding === 0) return pack(ownKind, width, false);
  const before = widthOf(preceding);
  const kind = kindOf(preceding);
  if (before === 0) return pack(ownKind, width, false); // nothing to attach to
  if (cp === ZWJ) return pack(KIND.zwj, before, true);
  if (kind === KIND.zwj && isPictographic(cp)) return pack(KIND.emoji, Math.max(before, width), true);
  if (cp === VS16) return pack(kind === KIND.emoji ? KIND.emoji : KIND.plain, kind === KIND.emoji ? 2 : before, true);
  if (cp === VS15) return pack(KIND.plain, before, true); // text style: keep the cells already taken
  if (isSkinTone(cp) && kind === KIND.emoji) return pack(KIND.emoji, Math.max(before, 2), true);
  if (isRegional(cp) && kind === KIND.regional) return pack(KIND.plain, 2, true); // the pair is one flag
  if (width === 0) return pack(kind === KIND.zwj ? KIND.plain : (kind as Kind), before, true); // marks, keycap, tags
  return pack(ownKind, width, false);
}

export const koluxUnicode: IUnicodeVersionProvider = {
  version: KOLUX_UNICODE,
  wcwidth: cellWidth,
  charProperties: charProps,
};

type UnicodeHost = { unicode: { register(p: IUnicodeVersionProvider): void; activeVersion: string; readonly versions: ReadonlyArray<string> } };

/** Register the provider on a terminal and make it the active width table. Safe to call twice. */
export function applyKoluxUnicode(term: UnicodeHost): void {
  try {
    if (!term.unicode.versions.includes(KOLUX_UNICODE)) term.unicode.register(koluxUnicode);
    term.unicode.activeVersion = KOLUX_UNICODE;
  } catch {
    // An older xterm without the (experimental) unicode API keeps its own table.
  }
}

/** Cells a whole string takes, the same way the terminal counts them (tests and layout helpers). */
export function stringCells(text: string): number {
  let total = 0;
  let prev = 0;
  for (const ch of text) {
    const props = charProps(ch.codePointAt(0)!, prev);
    total += widthOf(props) - (joins(props) ? widthOf(prev) : 0);
    prev = props;
  }
  return total;
}
