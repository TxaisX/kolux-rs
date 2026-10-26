// EDIT-019 (T-177): a note's front matter (YAML between --- lines, TOML between +++ lines) is kept
// out of the text the rich view edits, and a rich edit changes only the span of the body that
// differs, so everything else in the file (the front matter, line ends, raw HTML) stays byte for
// byte as it was. The text here is the buffer's (CodeMirror joins lines with \n; the file's own
// line ends are put back when it is written).
import { diff } from "@codemirror/merge";
import { changeBetween } from "./markdown";

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
 *  is unchanged. */
export function richChange(now: string, out: string, prev?: string): { from: number; to: number; insert: string } | null {
  const { front, body } = splitFront(now);
  const kept = keepRaw(body, out, prev);
  // The rich view drops the body's last line end; keep it.
  const next = body.endsWith("\n") && !kept.endsWith("\n") ? kept + "\n" : kept;
  const c = changeBetween(body, next);
  return c && { from: c.from + front.length, to: c.to + front.length, insert: c.insert };
}

const WORD = /[\p{L}\p{N}]+/gu;
const WINDOW_FROM = 8000;
const MARGIN_WORDS = 40;

/** Where the n-th word of `text` starts (the end of the text past the last word). */
function wordStart(text: string, n: number): number {
  WORD.lastIndex = 0;
  for (let i = 0, m; (m = WORD.exec(text)); i++) if (i === n) return m.index;
  return text.length;
}

/** How many words of `text` start before `p`. */
function wordsBefore(text: string, p: number): number {
  WORD.lastIndex = 0;
  let n = 0;
  for (let m; (m = WORD.exec(text)) && m.index < p; ) n++;
  return n;
}

const wordList = (text: string) => (text.match(WORD) ?? []).join(" ");

/** The stretch of `body` and of `prev` round the edit `f..t` (in `prev`), as [body from, prev from, body to, prev to]. Both
 *  spellings hold the same words, so the same word numbers mark the same places in each. Null when the words of the two
 *  stretches differ (the texts are not spellings of each other), so the caller diffs the whole of both. */
function stretch(body: string, prev: string, f: number, t: number): [number, number, number, number] | null {
  const k0 = Math.max(0, wordsBefore(prev, f) - MARGIN_WORDS);
  const k1 = wordsBefore(prev, t) + MARGIN_WORDS;
  const w: [number, number, number, number] = [wordStart(body, k0), wordStart(prev, k0), wordStart(body, k1), wordStart(prev, k1)];
  return wordList(body.slice(w[0], w[2])) === wordList(prev.slice(w[1], w[3])) ? w : null;
}

/** Row 135: the rich view gives back the whole body in its own spelling (its list markers, its
 *  emphasis marks, its blank lines). Only the span the user changed is taken from it: the body is
 *  matched against the rich view's spelling of it before the edit (`prev`), and every byte outside
 *  the edit, and outside any respelt bit the edit touches, stays as the file had it. */
export function keepRaw(body: string, out: string, prev?: string): string {
  if (prev === undefined) return out;
  const e = changeBetween(prev, out);
  if (!e) return body;
  let f = e.from;
  let t = e.to;
  const delta = e.insert.length - (t - f);
  // ponytail: one character diff per edit, capped at 50 ms; a capped diff is coarser, so it only widens the span taken.
  // Row 94 review: a big wrapped note differs from `prev` everywhere, so only the stretch round the edit is diffed.
  const w = body.length + prev.length > WINDOW_FROM ? stretch(body, prev, f, t) : null;
  const [ba, pa] = w ?? [0, 0];
  const respelt = (w ? diff(body.slice(ba, w[2]), prev.slice(pa, w[3]), { timeout: 50 }) : diff(body, prev, { timeout: 50 })).map((c) => ({ fromA: c.fromA + ba, toA: c.toA + ba, fromB: c.fromB + pa, toB: c.toB + pa }));
  for (const c of respelt) if (c.fromB < t && c.toB > f) (f = Math.min(f, c.fromB)), (t = Math.max(t, c.toB));
  // A place in `prev` outside every respelt bit, as a place in `body` (a bit only deleted from
  // `body` that sits right at the place stays after it).
  const at = (p: number) => respelt.reduce((n, c) => (c.toB < p || (c.toB === p && c.fromB < p) ? n + (c.toA - c.fromA) - (c.toB - c.fromB) : n), p + ba - pa);
  return body.slice(0, at(f)) + out.slice(f, t + delta) + body.slice(at(t));
}

/** Whether the front matter is hidden for `path`: the choice made while this file was shown, else the saved one. */
export function hideFrontFor(held: { path: string; hide: boolean }, path: string, saved: (path: string) => boolean): boolean {
  return held.path === path ? held.hide : saved(path);
}
