// EDIT-019 (T-177): a note's front matter (YAML between --- lines, TOML between +++ lines) is kept
// out of the text the rich view edits, and a rich edit changes only the span of the body that
// differs, so everything else in the file (the front matter, line ends, raw HTML) stays byte for
// byte as it was. The text here is the buffer's (CodeMirror joins lines with \n; the file's own
// line ends are put back when it is written).
import { diff } from "@codemirror/merge";
import { changeBetween, RICH_LIMIT, unsupported } from "./markdown";

/** The front matter block including its closing line and that line's end ("" when there is none),
 *  and the rest of the note. `front + body` is always the whole text. */
export function splitFront(text: string): { front: string; body: string; kind: "yaml" | "toml" | null } {
  // Row 134: a byte order mark before the opening line still opens front matter (it stays in `front`).
  const m = /^\uFEFF?(---|\+\+\+)[ \t]*\r?\n/.exec(text);
  if (!m) return { front: "", body: text, kind: null };
  const fence = m[1];
  const closer = fence === "---" ? /^(---|\.\.\.)[ \t]*(\r?\n|$)/gm : /^\+\+\+[ \t]*(\r?\n|$)/gm;
  closer.lastIndex = m[0].length;
  const c = closer.exec(text);
  if (!c) return { front: "", body: text, kind: null }; // never closed: it is note text, not front matter
  const end = c.index + c[0].length;
  return { front: text.slice(0, end), body: text.slice(end), kind: fence === "---" ? "yaml" : "toml" };
}

/** The change to the buffer for one rich edit: `now` is the buffer's text, `out` the markdown the
 *  rich view gives back for the body, `prev` what it gave back before this edit. Null when the body
 *  is unchanged, or when the edit could not be placed (then `refused` is called and nothing is written). */
export function richChange(now: string, out: string, prev?: string, refused?: () => void): { from: number; to: number; insert: string } | null {
  const { front, body } = splitFront(now);
  const placed = prev === undefined ? out : mapEdit(body, out, prev);
  if (placed === null) return refused?.(), null;
  // The rich view drops the body's last line end; keep it.
  const next = body.endsWith("\n") && !placed.endsWith("\n") ? placed + "\n" : placed;
  const c = changeBetween(body, next);
  return c && { from: c.from + front.length, to: c.to + front.length, insert: c.insert };
}

const WORD = /[\p{L}\p{N}]+/gu;

type Span = { s: number; e: number };
const wordSpans = (text: string): Span[] => Array.from(text.matchAll(WORD), (m) => ({ s: m.index, e: m.index + m[0].length }));

/** Whether `a` and `b` hold the same words in the same order, whatever lies between them. */
function sameWords(a: string, b: string): boolean {
  const x = a.match(WORD) ?? [];
  const y = b.match(WORD) ?? [];
  return x.length === y.length && x.every((w, i) => w === y[i]);
}

/** Row 135: the rich view gives back the whole body in its own spelling (its list markers, its
 *  emphasis marks, its blank lines). Only the span the user changed is taken from it: the body is
 *  matched against the rich view's spelling of it before the edit (`prev`), and every byte outside
 *  the edit, and outside any respelt bit the edit touches, stays as the file had it. Null when the
 *  edit cannot be placed for sure (see `mapEdit`); this version then keeps the body as it was. */
export function keepRaw(body: string, out: string, prev?: string): string {
  return prev === undefined ? out : (mapEdit(body, out, prev) ?? body);
}

/** The body with the rich edit (`prev` -> `out`) made in it, or null when the edit cannot be placed for sure.
 *  Both spellings hold the same words, so a place in `prev` is a word number plus an offset into the word, or into the
 *  gap between two words; only a gap can be spelt differently (markers, wraps, blank lines), and a place in a gap is
 *  found by a character diff of that one gap. Null (never a guess) when the words differ or the result does not
 *  hold exactly the words of `out`. */
export function mapEdit(body: string, out: string, prev: string): string | null {
  const e = changeBetween(prev, out);
  if (!e) return body;
  const bw = wordSpans(body);
  const pw = wordSpans(prev);
  if (bw.length !== pw.length || !sameWords(body, prev)) return null;
  // `p` in `prev` as [the same place or the edge of the respelt bit round it, its place in `body`]; `lo`: the edit's start.
  const place = (p: number, lo: boolean): [number, number] => {
    let g = 0; // the words that end at or before p
    for (let h = pw.length; g < h; ) {
      const mid = (g + h) >> 1;
      if (pw[mid].e <= p) g = mid + 1;
      else h = mid;
    }
    if (g < pw.length && pw[g].s < p) return [p, bw[g].s + p - pw[g].s]; // inside a word
    const ps = g ? pw[g - 1].e : 0;
    const bs = g ? bw[g - 1].e : 0;
    const P = prev.slice(ps, g < pw.length ? pw[g].s : prev.length);
    const B = body.slice(bs, g < bw.length ? bw[g].s : body.length);
    const lp = p - ps;
    if (P === B) return [p, bs + lp];
    // ponytail: one character diff of a gap, capped at 50 ms; a capped diff is coarser, so it only widens the bit taken.
    let la = lp;
    for (const c of diff(B, P, { timeout: 50 })) {
      if (c.fromB < lp && lp < c.toB) return lo ? [ps + c.fromB, bs + c.fromA] : [ps + c.toB, bs + c.toA];
      // A bit only deleted from `body` that sits right at the place stays after it.
      if (c.toB < lp || (c.toB === lp && c.fromB < lp)) la += c.toA - c.fromA - (c.toB - c.fromB);
    }
    return [p, bs + la];
  };
  const [f, bf] = place(e.from, true);
  const [t, bt] = place(e.to, false);
  if (bt < bf) return null;
  const next = body.slice(0, bf) + out.slice(f, t + e.insert.length - (e.to - e.from)) + body.slice(bt);
  return sameWords(next, out) ? next : null;
}

/** The banner for a note the rich view should not show (too big, or text it would garble or lose), null when it can show it.
 *  The first show and every later show of a changed note (twin pane, reload) ask this, so neither reaches the rich view
 *  with a body it cannot spell back faithfully. */
export function richBlocker(text: string, bigOk: boolean): { text: string; big?: boolean } | null {
  if (text.length > RICH_LIMIT && !bigOk) return { text: `This file is ${(text.length / 1048576).toFixed(1)} MB, so it opened in source view.`, big: true };
  const why = unsupported(splitFront(text).body);
  return why ? { text: `Showing source: the rich view cannot show this file because ${why}.` } : null;
}

/** Whether the front matter is hidden for `path`: the choice made while this file was shown, else the saved one. */
export function hideFrontFor(held: { path: string; hide: boolean }, path: string, saved: (path: string) => boolean): boolean {
  return held.path === path ? held.hide : saved(path);
}
