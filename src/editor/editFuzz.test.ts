import { describe, expect, it } from "vitest";
import { blockSpans, placeStats, richChange, splitFront } from "./frontMatter";
import { changeBetween, roundTrip, unsupported } from "./markdown";

// Row 94 review rounds 3-4: random everyday edits in the rich view, chained (each saved note is the next edit's input).
// After every edit the saved note reads back as the rich view's text, keeps every block away from the edit, and can
// still be shown in the rich view; or it is byte for byte the note before the edit (refused, source view). Nothing else.
const SEED = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FUZZ_SEED ?? 20261026);

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
  // Wraps that one deleted word away leave an underline, a rule or a reference definition.
  (i: number) => `Total score ${i}\n== 10 points`,
  (i: number) => `a dash run ${i}\n--- then more`,
  (i: number) => `temperature ${i} was\n-5 today`,
  (i: number) => `stars here ${i}\n* * * x`,
  (i: number) => `see ${i}\nthere [r]: u`,
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

/** What a placement must keep byte for byte: `body` through the last word before the blocks (items and section
 *  children unless `whole`, and then the whole list) that the edit `prev` -> `out` touches, in the rich view's blocks or the file's, whichever
 *  reach further, with one block of slack; and from the first word after them. `body` and `prev` hold the same words. */
function keptEnds(body: string, prev: string, out: string, whole: boolean): [string, string] {
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
    // Placed whole, a list is one block however many blank lines split it in the file.
    const item = (j: number) => whole && j >= 0 && j < blocks.length && LIST.test(t.slice(blocks[j].s));
    while (item(j0) && item(j0 - 1)) j0--;
    while (item(j1) && item(j1 + 1)) j1++;
    const s = blocks[j0].s;
    const end = blocks[j1].e;
    return [ws.filter((w) => w.index + w[0].length <= s).length, ws.filter((w) => w.index >= end).length];
  };
  const [p0, p1] = span(prev, pw, e.from, e.to);
  const upTo = (k: number) => (k <= 0 ? 0 : bw[k - 1].index + bw[k - 1][0].length);
  const from = (i: number) => (i >= bw.length ? body.length : bw[i].index);
  const [b0, b1] = span(body, bw, upTo(before), from(bw.length - after));
  const w0 = Math.min(p0, b0);
  const w1 = Math.min(p1, b1);
  return [body.slice(0, upTo(w0)), w1 ? body.slice(from(bw.length - w1)) : ""];
}

describe("fuzz: chained everyday rich-view edits save a note that reads back as the view's text, or refuse", () => {
  it(`400 chained edits (seed ${SEED})`, () => {
    const seed = SEED;
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
          expect(next, why).toBe(now);
          break; // the note goes to source view
        }
        // (1) It reads back as the view's text.
        expect(next.startsWith(front), why).toBe(true);
        expect(roundTrip(nb), why).toBe(out);
        // (2) Every block away from the edit keeps its bytes (the whole list or section when it was placed whole).
        const [head, tail] = keptEnds(body, prev, out, placeStats.whole !== whole);
        expect(nb.startsWith(head) && nb.endsWith(tail), why).toBe(true);
        // (3) A note the view could show stays one it can show, unless the view's own text cannot be shown.
        if (unsupported(out) === null) expect(unsupported(nb), why).toBeNull();
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
