// EDIT-019 (T-177): a note's front matter (YAML between --- lines, TOML between +++ lines) is kept
// out of the text the rich view edits, and a rich edit changes only the span of the body that
// differs, so everything else in the file (the front matter, line ends, raw HTML) stays byte for
// byte as it was. The text here is the buffer's (CodeMirror joins lines with \n; the file's own
// line ends are put back when it is written).
import { diff } from "@codemirror/merge";
import { changeBetween, htmlTagsOf, limitsOf, RICH_LIMIT, roundTrip, unsupported } from "./markdown";

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

/** How each rich edit was placed (the fuzz test reads it): by word number, by retyping the touched blocks, or refused;
 *  `whole` counts the placements that needed a whole list or section, not just its touched item or child. */
export const placeStats = { fast: 0, block: 0, refused: 0, whole: 0 };

/** The body with the rich edit (`prev` -> `out`) made in it, or null when the edit cannot be placed for sure.
 *  Round 3 of row 94: the word-mapped placement keeps every byte, but the word check cannot see a marker or a line break
 *  it damaged, so the touched blocks of the result, with one block of context on each side, must read back as the same
 *  blocks of `out`, and must not trip a line rule of `unsupported` that `out` does not (round 4: a wrap left as a setext
 *  underline, a rule or a reference definition). When they do not, the touched blocks are taken in `out`'s spelling and
 *  checked the same way; only a failure there refuses. Round 4: a bullet list's items and a section's children are
 *  blocks of their own, so only the touched item is retyped and checked; the whole list or section is used when the
 *  edit adds or removes a fence or section line, or the item-level placement fails. */
export function mapEdit(body: string, out: string, prev: string): string | null {
  const got = placeBody(body, out, prev);
  const e = changeBetween(prev, out);
  // Round 5 (LOW-2): a typed or removed < or > can open or close a tag blocks away, past what the placement reads, so the whole note is checked.
  if (got === null || got === body || !e || !/[<>]/.test(prev.slice(e.from, e.to) + e.insert)) return got;
  if (unsupported(body.endsWith("\n") ? out + "\n" : out) !== null || unsupported(got) === null) return got;
  placeStats.refused++;
  return null;
}

/** Round 5 (HIGH-1): the view drops a loose list's blank lines, so it is placed as the tight list the view reads and the gaps go back. */
function placeBody(body: string, out: string, prev: string): string | null {
  if (prev === out) return body;
  const tight = collapseGaps(body);
  if (!tight) return mapTight(body, out, prev);
  const next = mapTight(tight.text, out, prev);
  const kept = next === null ? null : regap(tight, next, prev, out);
  if (next !== null && kept === null) placeStats.refused++;
  return kept;
}

type Gap = { at: number; raw: string };

const ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const width = (s: string) => s.replace(/\t/g, "    ").length;
const kind = (m: RegExpExecArray) => (/\d/.test(m[2]) ? m[2].slice(-1) : m[2]);

/** `body` with the blank lines between sibling list items taken out (the list as the view reads it), and where each went.
 *  Null when there are none. Only blank lines straight before an item that continues the item list above it count;
 *  a blank line inside an item, before a paragraph or in code stays. */
export function collapseGaps(body: string): { text: string; gaps: Gap[] } | null {
  if (!BLANK.test(body)) return null;
  const gaps: Gap[] = [];
  const stack: { w: number; k: string }[] = [];
  let text = "";
  let fence = "";
  let blank = -1; // where the blank lines before this line start in `body`, or -1
  let copied = 0;
  let pos = 0;
  for (const line of body.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    if (/^[ \t]*\r?$/.test(line)) {
      if (blank < 0) blank = start;
      continue;
    }
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length && /^[ \t]*[`~]+[ \t]*\r?$/.test(line)) fence = "";
      blank = -1;
      continue;
    }
    if (f) fence = f;
    const m = ITEM.exec(line);
    if (m) {
      const w = width(m[1]);
      while (stack.length && stack[stack.length - 1].w > w) stack.pop();
      const top = stack[stack.length - 1];
      if (blank >= 0 && top && top.w === w && top.k === kind(m)) {
        text += body.slice(copied, blank);
        gaps.push({ at: text.length, raw: body.slice(blank, start) });
        copied = start;
      }
      if (top && top.w === w) stack.pop();
      stack.push({ w, k: kind(m) });
    } else {
      const w = width(/^[ \t]*/.exec(line)![0]);
      if (blank >= 0 && w === 0) stack.length = 0;
      else while (stack.length && stack[stack.length - 1].w >= w && w > 0) stack.pop();
    }
    blank = -1;
  }
  if (!gaps.length) return null;
  return { text: text + body.slice(copied), gaps };
}

/** `next` (the edited tight text) with the blank lines put back at the item boundaries they were at, found by word number
 *  (the edit changes `prev` into `out`). A boundary the edit itself covers is dropped; one it does not cover that cannot be
 *  found again makes the whole placement null, never a list tightened behind the user's back. */
function regap(tight: { text: string; gaps: Gap[] }, next: string, prev: string, out: string): string | null {
  const e = changeBetween(prev, out);
  if (!e) return restore(next, tight.gaps);
  const tw = wordSpans(tight.text);
  const pw = wordSpans(prev);
  const nw = wordSpans(next);
  if (tw.length !== pw.length) return null;
  const dw = nw.length - tw.length;
  const kept: Gap[] = [];
  let k = 0;
  for (const g of tight.gaps) {
    while (k < tw.length && tw[k].e <= g.at) k++;
    if (k === 0 || k >= tw.length) return null;
    // The boundary in the view's text is its last line break between the two words; an edit that covers it drops the gap.
    const cut = pw[k - 1].e + prev.slice(pw[k - 1].e, pw[k].s).lastIndexOf(String.fromCharCode(10));
    if (cut < pw[k - 1].e) return null;
    const before = e.to <= cut;
    if (!before && e.from <= cut) continue;
    const j = before ? k + dw : k;
    if (j < 1 || j >= nw.length) return null;
    const t = next.slice(nw[j - 1].e, nw[j].s);
    const nl = t.lastIndexOf("\n");
    if (nl < 0 || !/^[ \t]*([-*+][ \t]*)?$/.test(t.slice(nl + 1))) return null;
    kept.push({ at: nw[j - 1].e + nl + 1, raw: g.raw });
  }
  return looseReadsAlike(tight.text, next, kept) ? restore(next, kept) : null;
}

/** Whether the items around the edit read the same loose as tight: a table or HTML line after an item can start a block
 *  only in a loose item, and the view (which reads the tight list) would not see it. */
function looseReadsAlike(before: string, next: string, gaps: Gap[]): boolean {
  let cs = 0;
  const m = Math.min(before.length, next.length);
  while (cs < m && before.charCodeAt(cs) === next.charCodeAt(cs)) cs++;
  let ce = next.length;
  for (let k = before.length; ce > cs && k > cs && before.charCodeAt(k - 1) === next.charCodeAt(ce - 1); ) ce--, k--;
  let a = 0;
  let b = next.length;
  for (const r of next.matchAll(/\n[ \t]*\r?\n/g)) {
    if (r.index < cs) a = r.index + r[0].length;
    else if (r.index >= ce) { b = r.index; break; }
  }
  const i = gaps.findIndex((g) => g.at > cs);
  const lo = (i < 0 ? gaps.length : i) - 2;
  const hi = gaps.findIndex((g) => g.at >= ce);
  a = Math.max(a, gaps[lo]?.at ?? 0);
  b = Math.min(b, hi < 0 ? b : (gaps[hi + 1]?.at ?? b));
  const near = gaps.filter((g) => g.at > a && g.at < b).map((g) => ({ at: g.at - a, raw: g.raw }));
  if (!near.length) return true;
  const tightWin = next.slice(a, b);
  return roundTrip(restore(tightWin, near)) === roundTrip(tightWin);
}

function restore(text: string, gaps: Gap[]): string {
  let out = "";
  let at = 0;
  for (const g of gaps) {
    out += text.slice(at, g.at) + g.raw;
    at = g.at;
  }
  return out + text.slice(at);
}

function mapTight(body: string, out: string, prev: string): string | null {
  const e = changeBetween(prev, out);
  if (!e) return body;
  const bw = wordSpans(body);
  const pw = wordSpans(prev);
  if (bw.length !== pw.length || !sameWords(body, prev)) return (placeStats.refused++, null);
  const fast = wordPlace(body, out, prev, e, bw, pw);
  const got = placeIn(body, out, prev, e, bw, pw, fast, true) ?? placeIn(body, out, prev, e, bw, pw, fast, false);
  if (!got) return (placeStats.refused++, null);
  placeStats[got[1]]++;
  if (got[2]) placeStats.whole++;
  return got[0];
}

/** One try of `mapEdit` on `fine` (item and child) or whole blocks: [the body, how, whether whole blocks] or null. */
function placeIn(body: string, out: string, prev: string, e: Edit, bw: Span[], pw: Span[], fast: string | null, fine: boolean): [string, "fast" | "block", boolean] | null {
  const bb = blockSpans(body, fine);
  const pb = blockSpans(prev, fine);
  const delta = out.length - prev.length;
  const r = touched(body, prev, bw, pw, bb, pb, e);
  const n = bw.length;
  const w = r.i0 === 0 && r.i1 === n ? r : regionOf(body, prev, bw, pw, bb, pb, Math.max(0, r.i0 - 1), Math.min(n, r.i1 + 1));
  const outPart = out.slice(r.p.s, r.p.e + delta);
  const outCtx = out.slice(w.p.s, w.p.e + delta);
  const bodyCtx = body.slice(w.b.s, w.b.e);
  // A fence or section line added or removed can change how every later block reads: only whole blocks are sure.
  if (fine && shape(prev.slice(w.p.s, w.p.e)) !== shape(outCtx)) return null;
  // A loose list reads every item loose, so one item of context on each side is not the whole list's reading.
  if (fine && (looseList(body, bb, r.b) || looseList(prev, pb, r.p))) return null;
  const allowed = new Set([...limitsOf(outCtx), ...limitsOf(bodyCtx)]);
  const tags = new Set([...htmlTagsOf(outCtx), ...htmlTagsOf(bodyCtx)]); // a new HTML-looking span is a limit like a line rule
  const reads = (cand: string) => {
    const ctx = cand.slice(w.b.s, w.b.e + cand.length - body.length);
    return (!fine || shape(ctx) === shape(bodyCtx)) && limitsOf(ctx).every((x) => allowed.has(x)) && htmlTagsOf(ctx).every((x) => tags.has(x)) && same(ctx, outCtx);
  };
  if (fast !== null) {
    const end = fast.length - (body.length - r.b.e);
    const kept = end >= r.b.s && fast.startsWith(body.slice(0, r.b.s)) && fast.endsWith(body.slice(r.b.e));
    // L2: a line left holding only spaces reads as a blank line on disk, even where the rich view's reading agrees.
    if (kept && spaceLines(fast.slice(r.b.s, end)) <= spaceLines(body.slice(r.b.s, r.b.e)) && reads(fast)) return [fast, "fast", !fine];
  }
  const next = body.slice(0, r.b.s) + outPart + body.slice(r.b.e);
  return reads(next) ? [next, "block", !fine] : null;
}

/** Whether the rich view reads `a` and `b` the same (never when it fails on either). */
const same = (a: string, b: string) => {
  const x = roundTrip(a);
  return x !== null && x === roundTrip(b);
};

const spaceLines = (t: string) => (t.match(/^[ \t]+\r?$/gm) ?? []).length;

const OPEN = /^<details>[ \t]*\r?$/i;
const CLOSE = /^<\/details>[ \t]*\r?$/i;
const BULLET = /^[-*+][ \t]/;
const STRUCT = /^ {0,3}(`{3,}|~{3,})|^<\/?details>[ \t]*\r?$/gim;

const BLANK = /\n[ \t]*\r?\n/;

/** Whether a bullet list that blocks `g` of `t` reach into has a blank line inside or between its items. */
function looseList(t: string, spans: Span[], g: Span): boolean {
  const item = (i: number) => i >= 0 && i < spans.length && BULLET.test(t.slice(spans[i].s, spans[i].s + 2));
  let lo = spans.findIndex((x) => x.e >= g.s);
  if (lo < 0) return false;
  let hi = lo;
  while (hi + 1 < spans.length && spans[hi + 1].s <= g.e) hi++;
  while (item(lo - 1) && item(lo)) lo--;
  while (item(hi + 1) && item(hi)) hi++;
  for (let i = lo; i <= hi; i++) {
    if (!item(i)) continue;
    if (BLANK.test(t.slice(spans[i].s, spans[i].e)) || (i < hi && item(i + 1) && BLANK.test(t.slice(spans[i].e, spans[i + 1].s)))) return true;
  }
  return false;
}

/** The fence and section lines of `t` in order: what decides which of its lines are code, prose or a section. */
const shape = (t: string) => (t.match(STRUCT) ?? []).map((x) => x.trim().toLowerCase()).join("|");

/** Top-level markdown blocks: runs of lines between blank lines (a line end's \r left out). A fence or a section is
 *  one block, and an indented line after a blank line stays with the block above it (a list item's next paragraph).
 *  `fine` (round 4) also splits a bullet list at each top-level item (with its nested lines) and a section that
 *  starts a block into its opening lines, each child, and its closing line. */
export function blockSpans(text: string, fine = false): Span[] {
  const spans: Span[] = [];
  let fence = "";
  let depth = 0;
  let cur: Span | null = null;
  let gap = false;
  let list = false;
  let sec = false;
  let pos = 0;
  for (const line of text.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    if (!fence && (!depth || (sec && depth === 1)) && /^[ \t]*\r?$/.test(line)) {
      gap = cur !== null;
      continue;
    }
    const end = start + line.length - (line.endsWith("\r") ? 1 : 0);
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    const split = !fence && ((list && !depth && BULLET.test(line)) || (sec && depth === 1 && CLOSE.test(line)));
    if (cur && (!gap || /^[ \t]/.test(line)) && !split) cur.e = end;
    else {
      if (!depth) {
        list = fine && !f && BULLET.test(line);
        sec = fine && OPEN.test(line);
      }
      spans.push((cur = { s: start, e: end }));
    }
    gap = false;
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? "" : f;
    else if (!fence && OPEN.test(line)) depth++;
    else if (!fence && depth && CLOSE.test(line)) depth--;
    if (!depth) sec = false;
  }
  return spans;
}

/** How many of the (sorted) words end at or before `p`, and how many start before it. */
const count = (w: Span[], ok: (x: Span) => boolean) => {
  let g = 0;
  for (let h = w.length; g < h; ) {
    const mid = (g + h) >> 1;
    if (ok(w[mid])) g = mid + 1;
    else h = mid;
  }
  return g;
};
const endsBy = (w: Span[], p: number) => count(w, (x) => x.e <= p);
const startsBefore = (w: Span[], p: number) => count(w, (x) => x.s < p);

function findLast<T>(a: T[], f: (x: T) => boolean): T | undefined {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i])) return a[i];
  return undefined;
}

type Region = { i0: number; i1: number; b: Span; p: Span };

/** The blocks of `prev` the edit touches, and the blocks of `body` that hold the same words. */
function touched(body: string, prev: string, bw: Span[], pw: Span[], bb: Span[], pb: Span[], e: Edit): Region {
  const first = findLast(pb, (b) => b.s <= e.from);
  const last = pb.find((b) => b.e >= e.to);
  const i0 = first ? endsBy(pw, first.s) : 0;
  const i1 = last ? startsBefore(pw, last.e) : pw.length;
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
  const j0 = s === undefined && i0 ? endsBy(w, findLast(blocks, (b) => b.s <= w[i0 - 1].s)!.s) : i0;
  const j1 = e === undefined && i1 < w.length ? startsBefore(w, blocks.find((b) => b.e >= w[i1].e)!.e) : i1;
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
  const was = splitFront(before).body;
  const body = splitFront(text).body;
  const c = changeBetween(was, body);
  if (!c) return null;
  // Round 4 (M2): a fence or section line added or removed turns code into prose (or back) past the window.
  if (shape(linesOf(was, c.from, c.to)) || shape(linesOf(body, c.from, c.from + c.insert.length))) return richBlocker(text, bigOk);
  const blocks = blockSpans(body, true);
  const hi = c.from + c.insert.length;
  const k = blocks.findIndex((b) => b.e >= c.from);
  const i = Math.max(0, (k < 0 ? blocks.length - 1 : k) - 1);
  let j = blocks.length - 1;
  while (j > 0 && blocks[j].s > hi) j--;
  j = Math.min(blocks.length - 1, j + 1);
  return blocks.length ? blockedBy(unsupported(body.slice(blocks[i].s, blocks[j].e))) : null;
}

/** The whole lines of `t` that hold `from..to`. */
const linesOf = (t: string, from: number, to: number) => {
  const e = t.indexOf("\n", to);
  return t.slice(t.lastIndexOf("\n", from - 1) + 1, e < 0 ? t.length : e);
};

/** Whether the front matter is hidden for `path`: the choice made while this file was shown, else the saved one. */
export function hideFrontFor(held: { path: string; hide: boolean }, path: string, saved: (path: string) => boolean): boolean {
  return held.path === path ? held.hide : saved(path);
}
