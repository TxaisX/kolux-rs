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
  if (!c) return null;
  const crlf = inFileEnds(now, body[c.from - 1], c.insert);
  // Code lines keep their CR in the view, so the CRLF spelling is used only where the view reads it as it read the added lines.
  const insert = crlf !== c.insert && same(body.slice(0, c.from) + crlf + body.slice(c.to), next) ? crlf : c.insert;
  return { from: c.from + front.length, to: c.to + front.length, insert };
}

/** Round 8 (LOW-3): the view's lines end in \n; a note whose every line ends in \r\n gets its added lines the same way. */
function inFileEnds(now: string, before: string | undefined, insert: string): string {
  const bare = (s: string) => /(^|[^\r])\n/.test(s);
  if (!bare(before === "\r" ? "\r" + insert : insert) || bare(now) || !now.includes("\r\n")) return insert;
  return (before === "\r" ? "\r" + insert : insert).replace(/(?<!\r)\n/g, "\r\n").slice(before === "\r" ? 1 : 0);
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
  const got = placeLoose(body, out, prev);
  if (got === null || got === body || !/```|~~~/.test(body + got)) return got;
  if (fenceDamaged(body, got, prev, out)) return (placeStats.refused++, null);
  return got;
}

/** Round 7 (HIGH-1): the view spells a fence nested in a list item at column 0 (or, for `~~~`, as text), so a retyped item or code line
 *  can lose the fence's indent or the fence lines themselves. A placement is refused when a code line sits less indented than the fence
 *  it was in, or, with no fence line added or removed in the view's reading, when the file's count of fence lines changed. */
function fenceDamaged(body: string, got: string, prev: string, out: string): boolean {
  const was = fenceShorts(body);
  if ([...fenceShorts(got)].some(([l, n]) => n > (was.get(l) ?? 0))) return true;
  const lines = (t: string) => (t.match(/^[ \t]*(`{3,}|~{3,})/gm) ?? []).length;
  // An indented fence the placement moved to column 0 left its item.
  const nested = (t: string) => (t.match(/^[ \t]+(`{3,}|~{3,})/gm) ?? []).length;
  if (nested(got) < nested(body) && shape(prev) === shape(out)) return true;
  return shape(prev) === shape(out) && lines(body) !== lines(got);
}

function placeLoose(body: string, out: string, prev: string): string | null {
  const before = { ...placeStats };
  const first = placeTight(body, out, prev, collapseGaps(body));
  if (first !== null) return first;
  // Round 8 (MEDIUM-1): a refused placement is tried again with the blank line between a parent and its first sub-item taken out too.
  const deep = collapseGaps(body, true);
  if (!deep || deep.gaps.length === (collapseGaps(body)?.gaps.length ?? 0)) return null;
  const refused = { ...placeStats };
  Object.assign(placeStats, before);
  const again = placeTight(body, out, prev, deep);
  if (again === null) Object.assign(placeStats, refused);
  return again;
}

function placeTight(body: string, out: string, prev: string, tight: ReturnType<typeof collapseGaps>): string | null {
  const base = tight?.text ?? body;
  const next = mapTight(base, out, prev);
  let kept = next === null ? null : tight ? regap(tight, next, prev, out) : next;
  // A blank line the edit did not touch must survive the placement (the blocks retyped in the view's spelling can drop one).
  if (kept !== null && next !== null && blankLines(next) < blankLines(base) + blankLines(out) - blankLines(prev)) kept = null;
  if (kept !== null && next !== null && blankMoved(base, next, prev, out, new Set(tight?.gaps.map((g) => g.item)))) kept = null;
  if (next !== null && kept === null) placeStats.refused++;
  return kept;
}

/** Whether the retyped text added or dropped a blank line above an item away from the edit (the view spells a list loose when one item
 *  holds two blocks, tight otherwise, and a retyped list takes that spelling for the items the user did not touch). */
function blankMoved(base: string, next: string, prev: string, out: string, gapped: Set<number>): boolean {
  const e = changeBetween(prev, out);
  if (!e) return false;
  const ps = itemStarts(prev);
  const bs = itemStarts(base);
  const ns = itemStarts(next);
  const dn = itemStarts(out).length - ps.length;
  if (bs.length !== ps.length || ns.length - bs.length !== dn) return false;
  const fate = itemFates(prev, out, ps);
  const touched = (i: number) => i < 0 || (e.from <= (ps[i + 1] ?? prev.length) && e.to > ps[i]) || (e.from === e.to && e.from > ps[i] && e.from < (ps[i + 1] ?? prev.length));
  return ps.some((_, i) => {
    if (fate[i] === "cut" || touched(i) || touched(i - 1)) return false;
    const at = ns[fate[i] === "before" ? i : i + dn];
    if (at === undefined) return false;
    const had = blankAbove(base, bs[i]) !== 0;
    // Round 8 (LOW-1): a blank the view's loose spelling put above an item the file already has a gap above is swapped for the file's gap.
    return (blankAbove(next, at) !== 0) !== had && !(had === false && gapped.has(i));
  });
}

/** Blank lines straight above an indented line: inside an item, not a gap between blocks. */
const blankLines = (t: string) => (t.match(/\n[ \t]*\r?\n(?=[ \t]+\S)/g) ?? []).length;

/** Round 7 (HIGH-1): the view spells a fence nested in a list item at column 0, so a retyped code line loses the fence's indent and
 *  the item ends there. The non-blank code lines of fences opened with an indent that sit less indented than their fence, counted per line text. */
function fenceShorts(text: string): Map<string, number> {
  const found = new Map<string, number>();
  let fence = "";
  let indent = 0;
  for (const line of text.split("\n")) {
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length && /^[ \t]*[`~]+[ \t]*\r?$/.test(line)) fence = "";
      else if (indent && /\S/.test(line) && width(/^[ \t]*/.exec(line)![0]) < indent) found.set(line, (found.get(line) ?? 0) + 1);
      continue;
    }
    if (f) (fence = f), (indent = width(/^[ \t]*/.exec(line)![0]));
  }
  return found;
}

/** `at`: where the gap's item line starts in the tight text; `item`: that line's number among the tight text's item lines. */
type Gap = { at: number; raw: string; item: number; cut?: number; parent?: number };

const ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const width = (s: string) => s.replace(/\t/g, "    ").length;
const kind = (m: RegExpExecArray) => (/\d/.test(m[2]) ? m[2].slice(-1) : m[2]);

/** `body` with the blank lines between sibling list items taken out (the list as the view reads it), and where each went.
 *  Null when there are none. Only blank lines straight before an item that continues the item list above it count;
 *  a blank line inside an item, before a paragraph or in code stays. */
export function collapseGaps(body: string, parents = false): { text: string; gaps: Gap[] } | null {
  if (!BLANK.test(body)) return null;
  const gaps: Gap[] = [];
  const stack: { w: number; k: string; c: number; i: number }[] = [];
  let afterItem = false; // the last non-blank line was an item line
  let text = "";
  let fence = "";
  let blank = -1; // where the blank lines before this line start in `body`, or -1
  let copied = 0;
  let pos = 0;
  let items = 0;
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
      const sibling = blank >= 0 && top && top.w === w && top.k === kind(m);
      // Round 8 (MEDIUM-1): the blank line between a parent's text and its first sub-item (only when asked: the retry after a refusal).
      const child = parents && blank >= 0 && afterItem && top && top.i === items - 1 && w >= top.c && w <= top.c + 3;
      if (sibling || child) {
        text += body.slice(copied, blank);
        gaps.push({ at: text.length, raw: body.slice(blank, start), item: items, ...(child ? { parent: top.i } : {}) });
        copied = start;
      }
      if (top && top.w === w) stack.pop();
      stack.push({ w, k: kind(m), c: w + m[2].length + 1, i: items });
      items++;
      afterItem = true;
    } else {
      afterItem = false;
      const w = width(/^[ \t]*/.exec(line)![0]);
      if (blank >= 0 && w === 0) stack.length = 0;
      else while (stack.length && stack[stack.length - 1].w >= w && w > 0) stack.pop();
    }
    blank = -1;
  }
  if (!gaps.length) return null;
  return { text: text + body.slice(copied), gaps };
}

/** Where each item line of `text` starts (outside fences): the lines `collapseGaps` counts as items. */
function itemStarts(text: string): number[] {
  const starts: number[] = [];
  let fence = "";
  let pos = 0;
  for (const line of text.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    if (/^[ \t]*\r?$/.test(line)) continue;
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length && /^[ \t]*[`~]+[ \t]*\r?$/.test(line)) fence = "";
      continue;
    }
    if (f) fence = f;
    if (ITEM.test(line)) starts.push(start);
  }
  return starts;
}

const BLANK_LINE = /^[ \t]*\r?\n$/;

/** How long the one blank line above the line starting at `at` is (the edit left it there: the gap in the view's spelling, so the file's own
 *  bytes replace it); 0 when the line above is not blank; -1 when more than one is, which cannot be told apart from the file's gap. */
function blankAbove(text: string, at: number): number {
  const start = (end: number) => (end < 2 ? 0 : text.lastIndexOf("\n", end - 2) + 1); // the line that ends at `end`, after its line break
  if (at < 1) return 0;
  const s = start(at);
  if (!BLANK_LINE.test(text.slice(s, at))) return 0;
  if (s === 0) return -1;
  return BLANK_LINE.test(text.slice(start(s), s)) ? -1 : at - s;
}

const numberless = (line: string) => line.replace(/^([ \t]*)\d+([.)])/, "$1#$2");

/** Where each item line of `prev` stands against the edit, by whole lines with ordered numbers ignored (the view renumbers them):
 *  "before" it (the edit is wholly above the line, or only after its marker), "after" it (the line is below the edit, a pure
 *  insertion at its start counts), or "cut" (the edit changes its line break or marker). */
function itemFates(prev: string, out: string, starts: number[]): ("before" | "after" | "cut")[] {
  const pl = prev.split("\n").map(numberless);
  const ol = out.split("\n").map(numberless);
  let p = 0;
  while (p < pl.length && p < ol.length && pl[p] === ol[p]) p++;
  let s = 0;
  while (s < pl.length - p && s < ol.length - p && pl[pl.length - 1 - s] === ol[ol.length - 1 - s]) s++;
  const hi = pl.length - s;
  let col = 0; // how far line p reads the same in both: past the marker, the edit is inside the item's text
  if (p < pl.length && p < ol.length) while (col < pl[p].length && pl[p][col] === ol[p][col]) col++;
  const marker = p < pl.length ? (ITEM.exec(pl[p])?.[0].length ?? 0) : 0;
  const fates: ("before" | "after" | "cut")[] = [];
  let line = 0;
  let at = 0;
  for (const st of starts) {
    while (at < st) if (prev.charCodeAt(at++) === 10) line++;
    fates.push(line < p ? "before" : line >= hi ? "after" : line === p && ol.length - s > p && col >= marker ? "before" : "cut");
  }
  return fates;
}

/** `next` (the edited tight text) with the blank lines put back before the item lines they were before, found by item number
 *  (the edit changes `prev` into `out`). Row 94 round 6: never by word number, an emoji item has no words. A gap whose line
 *  break or marker the edit covers is dropped; one that cannot be found again for sure, or whose place does not read back as a
 *  gap between sibling items, makes the whole placement null, never a list tightened or a gap moved behind the user's back. */
function regap(tight: { text: string; gaps: Gap[] }, next: string, prev: string, out: string): string | null {
  const e = changeBetween(prev, out);
  if (!e) return restore(next, tight.gaps);
  const ts = itemStarts(tight.text);
  const ps = itemStarts(prev);
  const ns = itemStarts(next);
  const dn = itemStarts(out).length - ps.length;
  if (ts.length !== ps.length || ns.length - ts.length !== dn) return null;
  const kept: Gap[] = [];
  const used = new Set<number>();
  const fate = itemFates(prev, out, ps);
  for (const g of tight.gaps) {
    const f = fate[g.item];
    const j = f === "before" ? g.item : f === "after" ? g.item + dn : -1;
    const fp = g.parent === undefined ? f : fate[g.parent];
    // A parent gap is kept only where neither line is touched: an edit near it cannot say where the gap belongs now.
    if (g.parent !== undefined && (j < 0 || fp === "cut")) return null;
    if (j < 0) continue;
    if (j >= ns.length || used.has(j)) return null;
    used.add(j);
    const cut = blankAbove(next, ns[j]);
    if (cut < 0) return null;
    if (g.parent === undefined) {
      // Round 9 (HIGH-1): only when the edit made it so; a lazy line already reads as the parent's text in the file's own gap.
      if (noSiblingAbove(next, ns[j]) && !noSiblingAbove(tight.text, ts[g.item])) continue;
    } else if (lineAbove(next, ns[j]) !== ns[fp === "before" ? g.parent : g.parent + dn]) return null; // the parent is no longer right above
    kept.push({ at: ns[j] - cut, raw: g.raw, item: j, cut });
  }
  kept.sort((a, b) => a.at - b.at);
  const restored = restore(next, kept);
  return looseReadsAlike(tight.text, next, kept) ? restored : null;
}

/** Round 8 (MEDIUM-1): where the last non-blank line above `at` starts, or -1. */
function lineAbove(text: string, at: number): number {
  for (let end = at; end > 0; ) {
    const start = text.lastIndexOf("\n", end - 2) + 1;
    const line = text.slice(start, end);
    end = start;
    if (!/^[ \t]*\r?\n?$/.test(line)) return start;
  }
  return -1;
}

/** Round 8 (NEW-HIGH-1): whether the nested item line at `at` has no sibling above it any more (the edit deleted them), so it now sits
 *  right under its parent's text; a gap kept there would loosen the parent's list. */
function noSiblingAbove(text: string, at: number): boolean {
  const m = ITEM.exec(text.slice(at, at + 40));
  const w = m ? width(m[1]) : 0;
  if (!w) return false;
  for (let end = at; end > 0; ) {
    const start = text.lastIndexOf("\n", end - 2) + 1;
    const line = text.slice(start, end);
    end = start;
    if (/^[ \t]*\r?\n?$/.test(line)) continue;
    const above = width(/^[ \t]*/.exec(line)![0]);
    if (above < w) return true;
    if (above === w && ITEM.test(line)) return false;
  }
  return false;
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
  const near = gaps.filter((g) => g.at > a && g.at < b).map((g) => ({ at: g.at - a, raw: g.raw, cut: g.cut }));
  if (!near.length) return true;
  const tightWin = next.slice(a, b);
  return roundTrip(restore(tightWin, near)) === roundTrip(tightWin);
}

function restore(text: string, gaps: { at: number; raw: string; cut?: number }[]): string {
  let out = "";
  let at = 0;
  for (const g of gaps) {
    out += text.slice(at, g.at) + g.raw;
    at = g.at + (g.cut ?? 0);
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
  const lead = leadSpaces(body, w.b.s); // an indented first item reads as nested in a window that cuts its indent
  const bodyCtx = body.slice(w.b.s - lead, w.b.e);
  // A fence or section line added or removed can change how every later block reads: only whole blocks are sure.
  if (fine && shape(prev.slice(w.p.s, w.p.e)) !== shape(outCtx)) return null;
  // A loose list reads every item loose, so one item of context on each side is not the whole list's reading.
  if (fine && (looseList(body, bb, r.b) || looseList(prev, pb, r.p))) return null;
  // A line rule reads past the window's last character (a `[r]:` ends at its line end), so its limits take the whole last line.
  const wide = (t: string, from: number, to: number) => t.slice(from, t.indexOf("\n", Math.max(0, to - 1)) + 1 || t.length);
  const allowed = new Set([...limitsOf(wide(out, w.p.s, w.p.e + delta)), ...limitsOf(wide(body, w.b.s - lead, w.b.e))]);
  const tags = new Set([...htmlTagsOf(outCtx), ...htmlTagsOf(bodyCtx)]); // a new HTML-looking span is a limit like a line rule
  const reads = (cand: string) => {
    const ctx = cand.slice(w.b.s - lead, w.b.e + cand.length - body.length);
    return (!fine || shape(ctx) === shape(bodyCtx)) && limitsOf(wide(cand, w.b.s - lead, w.b.e + cand.length - body.length)).every((x) => allowed.has(x)) && htmlTagsOf(ctx).every((x) => tags.has(x)) && same(ctx, outCtx);
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

const leadSpaces = (t: string, s: number) => {
  let k = s;
  while (k > 0 && t[k - 1] === " ") k--;
  return k === 0 || t[k - 1] === "\n" ? s - k : 0;
};

/** Whether the rich view reads `a` and `b` the same (never when it fails on either). */
const same = (a: string, b: string) => {
  const x = roundTrip(a);
  return x !== null && x === roundTrip(b);
};

const spaceLines = (t: string) => (t.match(/^[ \t]+\r?$/gm) ?? []).length;

const OPEN = /^<details>[ \t]*\r?$/i;
const CLOSE = /^<\/details>[ \t]*\r?$/i;
// Round 5: a bullet or numbered item, indented up to three spaces; the indent is group 1.
const BULLET = /^( {0,3})([-*+]|\d+[.)])[ \t]/;
const STRUCT = /^ {0,3}(`{3,}|~{3,})|^<\/?details>[ \t]*\r?$/gim;

const BLANK = /\n[ \t]*\r?\n/;

/** Whether a bullet list that blocks `g` of `t` reach into has a blank line inside or between its items. */
function looseList(t: string, spans: Span[], g: Span): boolean {
  const item = (i: number) => i >= 0 && i < spans.length && BULLET.test(t.slice(spans[i].s, spans[i].s + 16));
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
 *  `fine` (round 4) also splits a bullet list (round 5: or a numbered one, indented up to three spaces) at each top-level item (with its nested lines) and a section that
 *  starts a block into its opening lines, each child, and its closing line. */
export function blockSpans(text: string, fine = false): Span[] {
  const spans: Span[] = [];
  let fence = "";
  let depth = 0;
  let cur: Span | null = null;
  let gap = false;
  let list = false;
  let indent = 0; // of the list's items
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
    const split = !fence && ((list && !depth && BULLET.exec(line)?.[1].length === indent) || (sec && depth === 1 && CLOSE.test(line)));
    if (cur && (!gap || /^[ \t]/.test(line)) && !split) cur.e = end;
    else {
      if (!depth) {
        const item = fine && !f ? BULLET.exec(line) : null;
        list = item !== null;
        indent = item ? item[1].length : 0;
        sec = fine && OPEN.test(line);
      }
      spans.push((cur = { s: start + (list && !depth ? indent : 0), e: end })); // an item starts after its indent, so a retyped item keeps it
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
