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
    const item = (j: number) => whole && j >= 0 && j < blocks.length && LISTLINE.test(t.slice(blocks[j].s, blocks[j].e));
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

/** Where the item lines of `t` start (outside fences). Written apart from frontMatter.ts, so the test does not trust it. */
function itemLines(t: string): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  let pos = 0;
  for (const line of t.split("\n")) {
    const f = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length && /^[ \t]*[`~]+[ \t]*\r?$/.test(line)) fence = null;
    } else if (f) fence = f;
    else if (/^[ \t]*([-*+]|\d+[.)])[ \t]/.test(line)) out.push(pos);
    pos += line.length + 1;
  }
  return out;
}

/** The blank-line gaps between sibling items of `t`: which item line each is before, and its bytes. */
function gapsOf(t: string): { item: number; raw: string }[] {
  const c = collapseGaps(t);
  if (!c) return [];
  const at = itemLines(c.text);
  return c.gaps.map((g) => ({ item: at.indexOf(g.at), raw: g.raw }));
}

/** Null when every gap of `body` that the edit `prev` -> `out` does not cover is in `saved` before the same item, spelt the same
 *  (so a gap dropped, moved to the next boundary or respelt as spaces fails), and `saved` holds no gap beyond those and the
 *  covered ones' own bytes; else why not. A gap is covered when the edit reaches the line break before its item or that item's marker. */
function gapProblem(body: string, saved: string, prev: string, out: string, head: string, tail: string): string | null {
  const gaps = gapsOf(body);
  if (!gaps.length) return null;
  const e = changeBetween(prev, out)!;
  const ps = itemLines(prev);
  const dn = itemLines(out).length - ps.length;
  const was = collapseGaps(body)!;
  if (itemLines(was.text).length !== ps.length) return `the view's text has ${ps.length} item lines, the file's ${itemLines(was.text).length}`;
  const want: { item: number; raw: string }[] = [];
  const covered: string[] = [];
  for (const g of gaps) {
    const line = ps[g.item];
    const marker = /^[ \t]*([-*+]|\d+[.)])[ \t]/.exec(prev.slice(line))![0].length;
    if (e.to > line - 1 && e.from < line + marker) covered.push(g.raw);
    else want.push({ item: e.to <= line - 1 ? g.item + dn : g.item, raw: g.raw });
  }
  const got = gapsOf(saved);
  const lines = itemLines(saved);
  // The gap's bytes sit right before the same item line, after the line break that ends the line above (a list the edit cut in two
  // is no longer read as having a gap there, but its blank lines are still the file's own).
  for (const w of want) {
    const at = lines[w.item];
    if (at === undefined || saved.slice(at - w.raw.length - 1, at) !== "\n" + w.raw) return `gap before item ${w.item} (${JSON.stringify(w.raw)}) is gone, moved or respelt`;
  }
  // A gap inside the span the edit retyped (between the kept head and tail) is in the view's spelling, so it may be one the file did not have.
  const extra = got.filter((g) => !want.some((w) => w.item === g.item && w.raw === g.raw) && !(lines[g.item] - g.raw.length >= head.length - 1 && lines[g.item] <= saved.length - tail.length + 1));
  if (extra.length > covered.length || extra.some((g) => !covered.includes(g.raw))) return `made-up gaps ${JSON.stringify(extra)}`;
  return null;
}

describe("fuzz: chained everyday rich-view edits save a note that reads back as the view's text, or refuse", () => {
  it.each(SEEDS)("400 chained edits (seed %i)", (seed) => {
    const r = rng(seed);
    Object.assign(placeStats, { fast: 0, block: 0, refused: 0, whole: 0 });
    const N = 400;
    let edits = 0;
    let refused = 0;
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
          refused++;
          if (ENV.FUZZ_REFUSED) console.log("REFUSED " + why);
          expect(next, why).toBe(now);
          break; // the note goes to source view
        }
        // (1) It reads back as the view's text.
        expect(next.startsWith(front), why).toBe(true);
        expect(roundTrip(nb), why).toBe(out);
        // (2) Every block away from the edit keeps its bytes (the whole list or section when it was placed whole).
        const [head, tail] = keptEnds(body, prev, out, placeStats.whole !== whole);
        expect(nb.startsWith(head) && nb.endsWith(tail), why + `
head=${JSON.stringify(head)}
tail=${JSON.stringify(tail)}`).toBe(true);
        // (4) Round 6: every blank-line gap the edit's range does not cover is where it was, spelt as it was; none is made up.
        expect(gapProblem(body, nb, prev, out, head, tail), why).toBeNull();
        // (3) A note the view could show stays one it can show, unless the view's own text cannot be shown.
        // richChange puts the body's last line end back, so that is the text the view's `out` becomes.
        if (unsupported(body.endsWith("\n") ? out + "\n" : out) === null) expect(unsupported(nb), why).toBeNull();
        now = next;
        prev = out;
        if (s) chained++;
      }
    }
    const ms = performance.now() - t0;
    expect(refused).toBeLessThanOrEqual(N / 50);
    // Shown with --silent=false: how often each path holds.
    console.log(`fuzz seed ${seed}: ${edits} edits (${chained} chained), fast ${placeStats.fast}, fallback ${placeStats.block}, on a whole list or section ${placeStats.whole}, refused ${refused}, mismatched 0, ${ms.toFixed(0)} ms`);
  }, 20_000);
});
