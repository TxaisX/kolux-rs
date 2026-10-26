import { marked, type Token } from "marked";
import { describe, expect, it } from "vitest";
import { blockSpans, collapseGaps, placeStats, richChange, splitFront } from "./frontMatter";
import { changeBetween, roundTrip, unsupported } from "./markdown";

// Row 94 review rounds 3-4: random everyday edits in the rich view, chained (each saved note is the next edit's input).
// After every edit the saved note reads back as the rich view's text, keeps every block away from the edit (on the file's own
// bytes, blank lines between list items included), keeps every blank-line gap between list items that the edit's range does
// not cover (same item, same spelling), and can still be shown in the rich view; or it is byte for byte the note before the
// edit (refused, source view). Nothing else.
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
// FUZZ_SEED=<n> runs one seed; FUZZ_RANGE=<a>-<b> runs every seed from a to b.
const [LO, HI] = ENV.FUZZ_RANGE ? ENV.FUZZ_RANGE.split("-").map(Number) : [Number(ENV.FUZZ_SEED ?? 20261026)];
const SEEDS = Array.from({ length: (HI ?? LO) - LO + 1 }, (_, i) => LO + i);

function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) % n;
  };
}

const HARD = /^[ \t]+(?:`{3,}|~{3,})|\n\n[ \t]+(?:[-*+]|\d+[.)])/m;

const KINDS = [
  (i: number) => `Para ${i} has _em_ and __strong__ text\nwrapped onto _line two_\nand three.`,
  (i: number) => `see _this_\nwrapped line ${i}`,
  (i: number) => `- item ${i}\n- item __two__\n- see _this_`,
  (i: number) => `* star ${i}\n* next one`,
  (i: number) => `## Head ${i}`,
  (i: number) => `the _API_ call ${i} and __API__ here`,
  () => `Ends with _italic_`,
  (i: number) => `1. one ${i}\n2. two`,
  // Round 4: quotes (no blank `>` line), tables, sections, fences with blank lines, nested, loose, `+` and `1)` lists.
  (i: number) => `> quote ${i} _q_\n> more text\nlazy line`,
  (i: number) => `| h${i} | b |\n|---|---|\n| _1_ | 2 |`,
  (i: number) => `<details>\n<summary>S ${i}</summary>\n\nInner __x__\nwrapped on\n\n- li _a_\n- li two\n\n</details>`,
  (i: number) => `\`\`\`\ncode ${i}\n\nmore code\n\`\`\``,
  (i: number) => `- item ${i}\n- item _two_\n  - nested __n__\n    deeper\n- three`,
  (i: number) => `* loose ${i}\n\n* loose _one_\n\n* loose two`,
  (i: number) => `+ plus ${i}\n+ plus __two__`,
  (i: number) => `1) paren ${i}\n2) two _x_`,
  (i: number) => `- a ${i}\n\n  indented para\n- b`,
  // Round 5: loose lists, where the view's text has no blank lines between items and the file does.
  (i: number) => `- loose ${i} _a_\n\n- two __b__\n  wrapped _w_\n\n- three\n\n- four __d__\n\n- five _e_`,
  (i: number) => `1. ord ${i} _a_\n\n2. two __b__\n   wrapped _w_\n\n3. three\n\n4. four __d__\n\n5. five _e_`,
  // Wraps that one deleted word away leave an underline, a rule or a reference definition.
  (i: number) => `Total score ${i}\n== 10 points`,
  (i: number) => `a dash run ${i}\n--- then more`,
  (i: number) => `temperature ${i} was\n-5 today`,
  (i: number) => `stars here ${i}\n* * * x`,
  (i: number) => `see ${i}\nthere [r]: u`,
  // Round 6: items with no words, items that start with markup or a task box, a fence inside an item (all loose).
  (i: number) => `- alpha ${i}\n\n- 🎉\n\n- gamma _g_\n\n- ...\n\n- five`,
  (i: number) => `- 🙂\n\n- ✅\n\n- 🙃\n- tail ${i}`,
  (i: number) => `- **Name:** Bob ${i}\n\n- **Age:** __3__\n\n- _Note_ three\n\n- __Last__ one`,
  (i: number) => `- [Home](http://h.com) page ${i}\n\n- [Away](http://a.com) page\n\n- more`,
  (i: number) => `- [ ] buy milk ${i}\n\n- [x] eggs _e_\n\n- [ ] bread`,
  (i: number) => `- \`npm i\` installs ${i}\n\n- \`npm t\` tests\n\n- done`,
  (i: number) => `- a ${i}\n\n  \`\`\`\n  x\n  \`\`\`\n\n- b _b_\n\n- c`,
  // Round 7: a sub-list to add to at its end, ordered lists loose and with a gap in the middle, fences inside items (tight too).
  (i: number) => `- parent ${i}\n  - n1 _a_\n\n- b\n\n- c`,
  (i: number) => `- a ${i}\n\n  - n1\n\n  - n2\n\n- b\n\n- c`,
  (i: number) => `1. alpha ${i}\n\n2. beta\n\n3. gamma\n\n4. delta`,
  (i: number) => `1. a ${i}\n2. b\n3. c\n\n4. d`,
  (i: number) => `- a ${i}\n  \`\`\`\n  x\n  \`\`\`\n- b\n- c`,
  (i: number) => `1. a ${i}\n\n   \`\`\`\n   x\n   \`\`\`\n\n2. b\n\n3. c`,
  (i: number) => `\`\`\`\n- x code line ${i}\n\`\`\`\n\n- a\n\n- b\n\n\`\`\`\n- y code line\n\`\`\``,
];

const PUNCT = [" ", ".", ",", "*", "_", "-", "=", "#", ">", "`", "|", "\n", "\n\n", "1. ", "- ", " word ", "Q", "[", "]", "\\"];

/** Places in `prev` where a user's keystroke is likely: word edges, line edges, beside marks. */
function spots(prev: string): number[] {
  const out: number[] = [0, prev.length];
  for (const m of prev.matchAll(/[\p{L}\p{N}]+|[*_`|>#=-]+|\n+/gu)) out.push(m.index, m.index + m[0].length);
  return out;
}

/** One random edit as the rich view would give it back, before its own spelling (`roundTrip`) is applied. */
function editOf(prev: string, r: (n: number) => number): { what: string; out: string } {
  const at = spots(prev);
  const p = at[r(at.length)];
  const ins = (t: string) => prev.slice(0, p) + t + prev.slice(p);
  const k = r(10);
  if (k <= 2) {
    const t = PUNCT[r(PUNCT.length)];
    return { what: `type ${JSON.stringify(t)}`, out: ins(t) };
  }
  if (k === 3) {
    const lineStart = prev.lastIndexOf("\n", p - 1) + 1;
    const item = /^ *([-*+]|\d+[.)]) /.exec(prev.slice(lineStart))?.[1];
    return { what: "Enter", out: ins(item ? `\n${/\d/.test(item) ? "9." : item} ` : "\n\n") };
  }
  if (k === 4) {
    const nl = [...prev.matchAll(/\n+(?: *[-*+] | *\d+[.)] |> )?/g)];
    if (!nl.length) return { what: "none", out: prev };
    const m = nl[r(nl.length)];
    return { what: "Backspace at line start", out: prev.slice(0, m.index) + prev.slice(m.index + m[0].length) };
  }
  if (k === 5) return { what: "Backspace", out: p > 0 ? prev.slice(0, p - 1) + prev.slice(p) : prev };
  if (k === 6) return { what: "delete", out: prev.slice(0, p) + prev.slice(Math.min(prev.length, p + 1 + r(20))) };
  if (k === 7) {
    const w = [...prev.matchAll(/ ?[\p{L}\p{N}]+/gu)];
    if (!w.length) return { what: "none", out: prev };
    const m = w[r(w.length)];
    return { what: "delete word", out: prev.slice(0, m.index) + prev.slice(m.index + m[0].length) };
  }
  if (k === 8) {
    const q = at[r(at.length)];
    const [a, b] = p < q ? [p, q] : [q, p];
    return { what: "replace selection", out: prev.slice(0, a) + (r(2) ? "" : PUNCT[r(PUNCT.length)]) + prev.slice(b) };
  }
  const ends = [...prev.matchAll(/\n\n|$/g)].map((m) => m.index);
  const e = ends[r(ends.length)];
  return { what: "end-dot", out: prev.slice(0, e) + "." + prev.slice(e) };
}

function note(r: (n: number) => number): string {
  const blocks = Array.from({ length: 2 + r(5) }, (_, i) => KINDS[r(KINDS.length)](i));
  let body = blocks.map((b, i) => (i ? ["\n\n", "\n\n\n", "\n\n\n\n"][r(3)] : "") + b).join("");
  if (r(2)) body += "\n";
  if (r(6) === 0) body = body.replace(/\n/g, "\r\n");
  return (r(5) === 0 ? "---\ntitle: fuzz\n---\n" : "") + body;
}

const WORD = /[\p{L}\p{N}]+/gu;
const LIST = /^ {0,3}([-*+]|\d+[.)])[ \t]/;
const LISTLINE = new RegExp(LIST.source, "m");
const FENCED = /^[ \t]*(`{3,}|~{3,})/;

/** What a placement must keep byte for byte: `body` through the last word before the blocks (items and section
 *  children unless `whole`, and then the whole list) that the edit `prev` -> `out` touches, in the rich view's blocks or the file's, whichever
 *  reach further, with one block of slack; and from the first word after them. `body` and `prev` hold the same words. */
function keptEnds(loose: string, prev: string, out: string, whole: boolean): [string, string] {
  const body = loose; // Round 6: the file's own bytes, blank lines between items included
  const e = changeBetween(prev, out)!;
  const bw = [...body.matchAll(WORD)];
  const pw = [...prev.matchAll(WORD)];
  const before = pw.filter((w) => w.index + w[0].length <= e.from).length;
  const after = pw.filter((w) => w.index >= e.to).length;
  // Words before (after) the block one before (after) the blocks holding the edit's edges, in `t`'s own blocks.
  const span = (t: string, ws: typeof bw, from: number, to: number): [number, number] => {
    const blocks = blockSpans(t, !whole);
    if (!blocks.length) return [0, 0];
    let i0 = blocks.length - 1;
    while (i0 > 0 && blocks[i0].s > from) i0--;
    let i1 = blocks.findIndex((x) => x.e >= to);
    if (i1 < 0) i1 = blocks.length - 1;
    let j0 = Math.max(0, i0 - 1);
    let j1 = Math.min(blocks.length - 1, i1 + 1);
    // Placed whole, a list is one block however many blank lines split it in the file, and a paragraph line above its first item
    // (the list interrupts it without a blank line) belongs to the block that holds that item.
    // Round 7: never a fenced block, whose list-looking code lines are code.
    const item = (j: number) => whole && j >= 0 && j < blocks.length && !FENCED.test(t.slice(blocks[j].s, blocks[j].e)) && LISTLINE.test(t.slice(blocks[j].s, blocks[j].e));
    while (item(j0) && item(j0 - 1)) j0--;
    while (item(j1) && item(j1 + 1)) j1++;
    const s = blocks[j0].s;
    const end = blocks[j1].e;
    return [ws.filter((w) => w.index + w[0].length <= s).length, ws.filter((w) => w.index >= end).length];
  };
  const [p0, p1] = span(prev, pw, e.from, e.to);
  const upTo = (k: number) => (k <= 0 ? 0 : bw[k - 1].index + bw[k - 1][0].length);
  const from = (i: number) => (i >= bw.length ? body.length : bw[i].index);
  // The blocks are the ones the placement sees (the tight text, where a list can fold into the paragraph above it); the bytes kept are the file's.
  const tight = collapseGaps(body)?.text ?? body;
  const tw = [...tight.matchAll(WORD)];
  const [b0, b1] = span(tight, tw, tw[before - 1] ? tw[before - 1].index + tw[before - 1][0].length : 0, tw[tw.length - after] ? tw[tw.length - after].index : tight.length);
  const w0 = Math.min(p0, b0);
  const w1 = Math.min(p1, b1);
  return [body.slice(0, upTo(w0)), w1 ? body.slice(from(bw.length - w1)) : ""];
}

// Round 7: an oracle that does not share regap's "covered" rule. `marked` reads the note before and after the save; the list items
// (in document order, each keyed by its depth and first line) and the code blocks that the edit's own span leaves alone must read the same.
type Entry = { key: string; shape: string; blankBefore: boolean | null; s: number; e: number };

function listEntries(src: string): { items: Entry[]; codes: string[] } {
  const items: Entry[] = [];
  const codes: string[] = [];
  const md = src.replace(/\r\n?/g, "\n");
  const walk = (ts: Token[], depth: number, from: number) => {
    let at = from;
    for (const t of ts) {
      const where = md.indexOf(t.raw, at);
      const s = where < 0 ? at : where;
      if (where >= 0) at = where + t.raw.length;
      if (t.type === "code") codes.push((t as { text: string }).text.trimEnd());
      if (t.type === "list") {
        const its = (t as { items: (Token & { text: string; tokens: Token[]; task?: boolean; checked?: boolean })[] }).items;
        let cur = s;
        its.forEach((it, i) => {
          const w = md.indexOf(it.raw, cur);
          const st = w < 0 ? cur : w;
          cur = st + it.raw.length;
          const kids = it.tokens.filter((k) => k.type !== "checkbox").map((k) => (k.type === "paragraph" ? "text" : k.type)); // loose or tight reads the same here
          while (kids[kids.length - 1] === "space") kids.pop();
          const prevRaw = i ? its[i - 1].raw : "";
          items.push({ key: depth + "|" + (it.task ? (it.checked ? "x" : "o") : "") + it.text.split("\n")[0].trim(), shape: kids.join(","), blankBefore: i ? /\n[ \t]*\n$/.test(prevRaw) : null, s: st, e: cur });
          walk(it.tokens, depth + 1, st);
        });
        continue;
      }
      const k = t as { tokens?: Token[] };
      if (k.tokens) walk(k.tokens, depth, s);
    }
  };
  walk(marked.lexer(md), 0, 0);
  return { items, codes };
}

/** How many entries of `a` and `b` agree at the start, and at the end of what is left. */
function sameEnds<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number] {
  let p = 0;
  while (p < a.length && p < b.length && eq(a[p], b[p])) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && eq(a[a.length - 1 - s], b[b.length - 1 - s])) s++;
  return [p, s];
}

/** Null when `saved` keeps what `body` had around the edit `prev` -> `out`. Every list item the edit did not change (keyed by its
 *  depth and first line, in document order) keeps the blank line above it, or the lack of one (the loose/tight gap to its previous
 *  sibling, wherever the edit put its neighbours), and, when the edit's span in the view's text does not reach it, its shape (a
 *  blank line between its own blocks). The code blocks the edit did not change read the same. Read by `marked`, not by regap's rule. */
function structureProblem(body: string, saved: string, prev: string, out: string): string | null {
  const was = listEntries(body);
  const now = listEntries(saved);
  // Ordered numbers are the view's to renumber, so the edit's span is read with them all set to 1.
  const ones = (t: string) => t.replace(/^([ \t]*)\d+([.)])/gm, "$11$2");
  const view = listEntries(ones(prev));
  const e = changeBetween(ones(prev), ones(out))!;
  // A lone carriage return (typed inside a CRLF note) is a line end to marked and plain text to the view.
  if (/\r(?!\n)/.test(body)) return null;
  // marked reads raw HTML blocks (an unclosed tag swallows what follows) where the view sends the note to source.
  if (/<\/?[a-zA-Z]/.test(body)) return null;
  // A typed or removed < or > can open or close a tag blocks away, and marked and the view disagree about unclosed tags.
  if (/[<>]/.test(ones(prev).slice(e.from, e.to) + e.insert)) return null;
  const viewOut = listEntries(ones(out));
  const [p, s] = sameEnds(was.items, now.items, (x, y) => x.key === y.key);
  // Code blocks: no more changed than the view's own edit changed.
  const pc = view.codes;
  const outCodes = sameEnds(pc, listEntries(out).codes, (x, y) => x === y);
  const file = sameEnds(was.codes, now.codes, (x, y) => x === y);
  const viewChanged = pc.length - outCodes[0] - outCodes[1];
  const fileChanged = was.codes.length - file[0] - file[1];
  if (fileChanged > Math.max(viewChanged, 0)) return `${fileChanged} code blocks changed, the edit changed ${viewChanged}: ${JSON.stringify(was.codes)} -> ${JSON.stringify(now.codes)}`;
  // The items of the view's text the edit's span overlaps (an insertion strictly inside one counts), when they line up with the file's.
  const aligned = view.items.length === was.items.length && !prev.includes("\r");
  const touched = (i: number) => !aligned || i < 0 || (e.from <= view.items[i].e && e.to > view.items[i].s) || (e.from === e.to && e.from > view.items[i].s && e.from < view.items[i].e);
  const pairs: [number, number][] = [];
  for (let i = 0; i < p; i++) pairs.push([i, i]);
  for (let i = 1; i <= s; i++) pairs.push([was.items.length - i, now.items.length - i]);
  for (const [a, b] of pairs) {
    const x = was.items[a];
    const y = now.items[b];
    if (touched(a)) continue;
    const vi = a < p ? a : a + viewOut.items.length - view.items.length;
    // The edit itself can take the gap away (Backspace joins the line above the gap to the line below it): the view's own text changed it.
    const viewGap = view.items[a]?.blankBefore !== viewOut.items[vi]?.blankBefore;
    // An item the save retyped in the view's spelling (a fence lifted out of it) is placed whole, gap and all.
    const retyped = ones(body.slice(x.s, x.e)).trimEnd() !== ones(saved.slice(y.s, y.e)).trimEnd();
    if (!viewGap && !retyped && x.blankBefore !== null && y.blankBefore !== null && x.blankBefore !== y.blankBefore) {
      // A blank line the view's own spelling put beside the edited item (an empty item is followed by one) is not made up.
      if (!x.blankBefore && touched(a - 1)) continue;
      return `the blank line above item ${a} ${JSON.stringify(x.key)} is ${x.blankBefore ? "gone" : "made up"} after the save`;
    }
    // The edit itself can change how an item reads in the view (an indent that joins a paragraph to it, a > that quotes it).
    const viewShape = (view.items[a]?.shape ?? "") !== (viewOut.items[vi]?.shape ?? "");
    // Where the view already read the item differently from the file before the edit (it retypes a nested indent), the old shape binds nothing.
    const viewSaw = view.items[a]?.shape !== x.shape;
    if (x.shape !== y.shape && viewChanged === 0 && !viewShape && !viewSaw) return `item ${a} ${JSON.stringify(x.key)} reads ${x.shape} before, ${y.shape} after the save`;
  }
  return null;
}

describe("fuzz: chained everyday rich-view edits save a note that reads back as the view's text, or refuse", () => {
  it.each(SEEDS)("400 chained edits (seed %i)", (seed) => {
    const r = rng(seed);
    Object.assign(placeStats, { fast: 0, block: 0, refused: 0, whole: 0 });
    const N = 400;
    let edits = 0;
    let refused = 0;
    let refusedHard = 0;
    let chained = 0;
    const t0 = performance.now();
    while (edits < N) {
      let now = note(r);
      if (unsupported(splitFront(now).body)) continue;
      let prev = roundTrip(splitFront(now).body)!;
      for (let s = 0; s < 12 && edits < N; s++) {
        const { what, out: typed } = editOf(prev, r);
        const out = roundTrip(typed);
        // Only edits the rich view could have made: its text is its own spelling, stable, and changed.
        if (out === null || out === prev || roundTrip(out) !== out) continue;
        edits++;
        const { front, body } = splitFront(now);
        let no = 0;
        const whole = placeStats.whole;
        const c = richChange(now, out, prev, () => no++);
        const next = c ? now.slice(0, c.from) + c.insert + now.slice(c.to) : now;
        const nb = next.slice(front.length);
        const why = `FUZZ_SEED=${seed}, edit ${edits}, chain step ${s} (${what})\nbody=${JSON.stringify(body)}\nprev=${JSON.stringify(prev)}\nout=${JSON.stringify(out)}\nnext=${JSON.stringify(nb)}`;
        if (no) {
          if (HARD.test(body)) refusedHard++;
          else refused++;
          expect(next, why).toBe(now);
          break; // the note goes to source view
        }
        // (1) It reads back as the view's text.
        expect(next.startsWith(front), why).toBe(true);
        // The view reads a table row under a list item with a blank above it or not, by the loose lists earlier in the note (its own quirk, same on round 6).
        const rowGap = (t: string | null) => t?.replace(/\n\n(?=\|)/g, "\n");
        expect(rowGap(roundTrip(nb)), why).toBe(rowGap(out));
        // (2) Every block away from the edit keeps its bytes (the whole list or section when it was placed whole).
        const [head, tail] = keptEnds(body, prev, out, placeStats.whole !== whole);
        expect(nb.startsWith(head) && nb.endsWith(tail), why + `
head=${JSON.stringify(head)}
tail=${JSON.stringify(tail)}`).toBe(true);
        // (4) Round 7: marked reads every list and code block the edit left alone as it did before (loose or tight, same content).
        expect(structureProblem(body, nb, prev, out), why).toBeNull();
        // (3) A note the view could show stays one it can show, unless the view's own text cannot be shown.
        // richChange puts the body's last line end back, so that is the text the view's `out` becomes.
        if (unsupported(body.endsWith("\n") ? out + "\n" : out) === null) expect(unsupported(nb), why).toBeNull();
        now = next;
        prev = out;
        if (s) chained++;
      }
    }
    const ms = performance.now() - t0;
    // Notes the view cannot spell (a fence in an item, a blank line inside a list item) refuse more: random selections tear their fences. Ordinary notes mix several loose and nested lists now: 2% was the round 6 bar, 3% holds with the new shapes.
    expect(refused, "refused on ordinary notes").toBeLessThanOrEqual(N / 35);
    expect(refusedHard, "refused on notes with a nested fence or a loose nested list").toBeLessThanOrEqual(N / 8);
    // Shown with --silent=false: how often each path holds.
    console.log(`fuzz seed ${seed}: ${edits} edits (${chained} chained), fast ${placeStats.fast}, fallback ${placeStats.block}, on a whole list or section ${placeStats.whole}, refused ${refused}, mismatched 0, ${ms.toFixed(0)} ms`);
  }, 20_000);
});
