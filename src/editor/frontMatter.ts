// EDIT-019 (T-177): a note's front matter (YAML between --- lines, TOML between +++ lines) is kept
// out of the text the rich view edits, and a rich edit changes only the span of the body that
// differs, so everything else in the file (the front matter, line ends, raw HTML) stays byte for
// byte as it was. The text here is the buffer's (CodeMirror joins lines with \n; the file's own
// line ends are put back when it is written).
import { diff } from "@codemirror/merge";
import { changeBetween, RICH_LIMIT, roundTrip, unsupported } from "./markdown";

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

type Edit = { from: number; to: number; insert: string };

/** How each rich edit was placed (the fuzz test reads it): by word number, by retyping the touched blocks, or refused. */
export const placeStats = { fast: 0, block: 0, refused: 0 };

/** The body with the rich edit (`prev` -> `out`) made in it, or null when the edit cannot be placed for sure.
 *  Round 3 of row 94: the word-mapped placement keeps every byte, but the word check cannot see a marker or a line break
 *  it damaged, so the touched blocks of the result must read back as the same blocks of `out`. When they do not, those
 *  blocks are taken in `out`'s spelling (the file loses its own spelling only in the paragraphs the user edited) and
 *  checked again with one block of context on each side; only a failure there refuses. */
export function mapEdit(body: string, out: string, prev: string): string | null {
  const e = changeBetween(prev, out);
  if (!e) return body;
  const bw = wordSpans(body);
  const pw = wordSpans(prev);
  if (bw.length !== pw.length || !sameWords(body, prev)) return (placeStats.refused++, null);
  const bb = blockSpans(body);
  const pb = blockSpans(prev);
  const delta = out.length - prev.length;
  const r = touched(body, prev, bw, pw, bb, pb, e);
  const outPart = out.slice(r.p.s, r.p.e + delta);
  const fast = wordPlace(body, out, prev, e, bw, pw);
  if (fast !== null) {
    const end = fast.length - (body.length - r.b.e);
    const kept = end >= r.b.s && fast.startsWith(body.slice(0, r.b.s)) && fast.endsWith(body.slice(r.b.e));
    // L2: a line left holding only spaces reads as a blank line on disk, even where the rich view's reading agrees.
    const part = fast.slice(r.b.s, end);
    if (kept && spaceLines(part) <= spaceLines(body.slice(r.b.s, r.b.e)) && same(part, outPart)) return (placeStats.fast++, fast);
  }
  const next = body.slice(0, r.b.s) + outPart + body.slice(r.b.e);
  const n = bw.length;
  const w = r.i0 === 0 && r.i1 === n ? r : regionOf(body, prev, bw, pw, bb, pb, Math.max(0, r.i0 - 1), Math.min(n, r.i1 + 1));
  const shift = next.length - body.length;
  if (same(next.slice(w.b.s, w.b.e + shift), out.slice(w.p.s, w.p.e + delta))) return (placeStats.block++, next);
  return (placeStats.refused++, null);
}

/** Whether the rich view reads `a` and `b` the same (never when it fails on either). */
const same = (a: string, b: string) => {
  const x = roundTrip(a);
  return x !== null && x === roundTrip(b);
};

const spaceLines = (t: string) => (t.match(/^[ \t]+\r?$/gm) ?? []).length;

const OPEN = /^<details>[ \t]*\r?$/i;
const CLOSE = /^<\/details>[ \t]*\r?$/i;

/** Top-level markdown blocks: runs of lines between blank lines (a line end's \r left out). A fence or a section is
 *  one block, and an indented line after a blank line stays with the block above it (a list item's next paragraph). */
export function blockSpans(text: string): Span[] {
  const spans: Span[] = [];
  let fence = "";
  let depth = 0;
  let cur: Span | null = null;
  let gap = false;
  let pos = 0;
  for (const line of text.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    if (!fence && !depth && /^[ \t]*\r?$/.test(line)) {
      gap = cur !== null;
      continue;
    }
    const end = start + line.length - (line.endsWith("\r") ? 1 : 0);
    if (cur && (!gap || /^[ \t]/.test(line))) cur.e = end;
    else spans.push((cur = { s: start, e: end }));
    gap = false;
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? "" : f;
    else if (!fence && OPEN.test(line)) depth++;
    else if (!fence && depth && CLOSE.test(line)) depth--;
  }
  return spans;
}

function findLast<T>(a: T[], f: (x: T) => boolean): T | undefined {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i])) return a[i];
  return undefined;
}

type Region = { i0: number; i1: number; b: Span; p: Span };

/** The blocks of `prev` the edit touches, and the blocks of `body` that hold the same words. */
function touched(body: string, prev: string, bw: Span[], pw: Span[], bb: Span[], pb: Span[], e: Edit): Region {
  const first = findLast(pb, (b) => b.s <= e.from);
  const last = pb.find((b) => b.e >= e.to);
  const i0 = first ? pw.filter((w) => w.e <= first.s).length : 0;
  const i1 = last ? pw.filter((w) => w.s < last.e).length : pw.length;
  const r = regionOf(body, prev, bw, pw, bb, pb, i0, i1);
  return r.p.s <= e.from && r.p.e >= e.to ? r : { i0: 0, i1: pw.length, b: { s: 0, e: body.length }, p: { s: 0, e: prev.length } };
}

/** Words `i0..i1` widened until, in both texts, they are whole blocks: from the first block after word i0-1 to the
 *  last block before word i1 (so blocks with no words between them go too). */
function regionOf(body: string, prev: string, bw: Span[], pw: Span[], bb: Span[], pb: Span[], i0: number, i1: number): Region {
  for (;;) {
    const b = edges(body, bw, bb, i0, i1);
    const p = edges(prev, pw, pb, i0, i1);
    const j0 = Math.min(b.i0, p.i0);
    const j1 = Math.max(b.i1, p.i1);
    if (j0 === i0 && j1 === i1) return { i0, i1, b, p };
    i0 = j0;
    i1 = j1;
  }
}

function edges(text: string, w: Span[], blocks: Span[], i0: number, i1: number): Span & { i0: number; i1: number } {
  if (!blocks.length) return { s: 0, e: text.length, i0, i1 };
  const lo = i0 ? w[i0 - 1].e : 0;
  const hi = i0 < w.length ? w[i0].s : text.length;
  const s = blocks.find((b) => b.s >= lo && b.s <= hi)?.s;
  const lo1 = i1 ? w[i1 - 1].e : 0;
  const hi1 = i1 < w.length ? w[i1].s : text.length;
  const e = findLast(blocks, (b) => b.e >= lo1 && b.e <= hi1)?.e;
  // A block that holds word i0-1 and word i0 (or i1-1 and i1) goes in whole.
  const j0 = s === undefined && i0 ? w.filter((x) => x.e <= findLast(blocks, (b) => b.s <= w[i0 - 1].s)!.s).length : i0;
  const j1 = e === undefined && i1 < w.length ? w.filter((x) => x.s < blocks.find((b) => b.e >= w[i1].e)!.e).length : i1;
  return { s: s ?? 0, e: e ?? text.length, i0: j0, i1: j1 };
}

/** The fast path of `mapEdit`: the edit placed by word number. Both spellings hold the same words, so a place in `prev` is a word number plus an offset into the word, or into the
 *  gap between two words; only a gap can be spelt differently (markers, wraps, blank lines), and a place in a gap is
 *  found by a character diff of that one gap. Null (never a guess) when the words differ or the result does not
 *  hold exactly the words of `out`. */
function wordPlace(body: string, out: string, prev: string, e: Edit, bw: Span[], pw: Span[]): string | null {
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
  return blockedBy(unsupported(splitFront(text).body));
}

const blockedBy = (why: string | null) => (why ? { text: `Showing source: the rich view cannot show this file because ${why}.` } : null);

/** Row 94 L1: `richBlocker` for a re-show of `text` when `before` was already shown. Only the changed blocks and one
 *  block on each side are checked, so a twin pane's keystroke does not round-trip the whole note. */
export function richBlockerSince(before: string, text: string, bigOk: boolean): { text: string; big?: boolean } | null {
  if (text.length > RICH_LIMIT && !bigOk) return richBlocker(text, bigOk);
  const body = splitFront(text).body;
  const c = changeBetween(splitFront(before).body, body);
  if (!c) return null;
  const blocks = blockSpans(body);
  const hi = c.from + c.insert.length;
  const k = blocks.findIndex((b) => b.e >= c.from);
  const i = Math.max(0, (k < 0 ? blocks.length - 1 : k) - 1);
  let j = blocks.length - 1;
  while (j > 0 && blocks[j].s > hi) j--;
  j = Math.min(blocks.length - 1, j + 1);
  return blocks.length ? blockedBy(unsupported(body.slice(blocks[i].s, blocks[j].e))) : null;
}

/** Whether the front matter is hidden for `path`: the choice made while this file was shown, else the saved one. */
export function hideFrontFor(held: { path: string; hide: boolean }, path: string, saved: (path: string) => boolean): boolean {
  return held.path === path ? held.hide : saved(path);
}
