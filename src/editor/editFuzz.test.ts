import { describe, expect, it } from "vitest";
import { placeStats, richChange, splitFront } from "./frontMatter";
import { roundTrip, unsupported } from "./markdown";

// Row 94 review round 3: random everyday edits in the rich view. After every edit the saved note either reads back as
// the rich view's text, or is byte for byte the note before the edit (refused, source view). Nothing else.
const SEED = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FUZZ_SEED ?? 20261026);

function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
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
  (i: number) => `Plain words only here ${i}.`,
  (i: number) => `1. one ${i}\n2. two`,
];

/** Places in `prev` where a user's keystroke is likely: word edges, line edges, beside emphasis marks. */
function spots(prev: string): number[] {
  const out: number[] = [0, prev.length];
  for (const m of prev.matchAll(/[\p{L}\p{N}]+|\*+|\n/gu)) out.push(m.index, m.index + m[0].length);
  return out;
}

/** One random edit as the rich view would give it back (its own spelling of the edited text). */
function editOf(prev: string, r: (n: number) => number): { what: string; out: string } {
  const at = spots(prev);
  const p = at[r(at.length)];
  const ins = (t: string) => prev.slice(0, p) + t + prev.slice(p);
  const k = r(9);
  if (k === 0) return { what: "word", out: ins(" new ") };
  if (k === 1) return { what: "Q", out: ins("Q") };
  if (k === 2) return { what: "dot", out: ins(".") };
  if (k === 3) {
    const lineStart = prev.lastIndexOf("\n", p - 1) + 1;
    const item = /^([-*]|\d+\.) /.exec(prev.slice(lineStart))?.[1];
    return { what: "Enter", out: ins(item ? `\n${/\d/.test(item) ? "9." : item} ` : "\n\n") };
  }
  if (k === 4) {
    // Backspace at a line's start: the line joins the one above.
    const nl = [...prev.matchAll(/\n+(?:[-*] |\d+\. )?/g)];
    if (!nl.length) return { what: "none", out: prev };
    const m = nl[r(nl.length)];
    return { what: "Backspace", out: prev.slice(0, m.index) + prev.slice(m.index + m[0].length) };
  }
  if (k === 5) {
    // A period at the end of a block.
    const ends = [...prev.matchAll(/\n\n|$/g)].map((m) => m.index);
    const e = ends[r(ends.length)];
    return { what: "end-dot", out: prev.slice(0, e) + "." + prev.slice(e) };
  }
  if (k === 6) return { what: "del", out: prev.slice(0, p) + prev.slice(Math.min(prev.length, p + 1 + r(12))) };
  if (k === 7) {
    const w = [...prev.matchAll(/ ?[\p{L}\p{N}]+/gu)];
    if (!w.length) return { what: "none", out: prev };
    const m = w[r(w.length)];
    return { what: "delword", out: prev.slice(0, m.index) + prev.slice(m.index + m[0].length) };
  }
  return { what: "comma", out: ins(",") };
}

function note(r: (n: number) => number): string {
  const blocks = Array.from({ length: 3 + r(4) }, (_, i) => KINDS[r(KINDS.length)](i));
  let body = blocks.map((b, i) => (i ? (r(3) ? "\n\n" : "\n\n\n\n") : "") + b).join("");
  if (r(2)) body += "\n";
  if (r(6) === 0) body = body.replace(/\n/g, "\r\n");
  return (r(5) === 0 ? "---\ntitle: fuzz\n---\n" : "") + body;
}

describe("fuzz: everyday rich-view edits save a note that reads back as the view's text, or refuse", () => {
  it(`300 seeded edits (seed ${SEED})`, () => {
    const r = rng(SEED);
    Object.assign(placeStats, { fast: 0, block: 0, refused: 0 });
    let edits = 0;
    let refused = 0;
    const t0 = performance.now();
    while (edits < 300) {
      const now = note(r);
      const { front, body } = splitFront(now);
      if (unsupported(body)) continue;
      const prev = roundTrip(body)!;
      for (let s = 0; s < 10 && edits < 300; s++) {
        const { what, out: typed } = editOf(prev, r);
        const out = roundTrip(typed);
        // Only edits the rich view could have made: its text is its own spelling, stable, and changed.
        if (out === null || out === prev || roundTrip(out) !== out) continue;
        edits++;
        let no = 0;
        const c = richChange(now, out, prev, () => no++);
        const next = c ? now.slice(0, c.from) + c.insert + now.slice(c.to) : now;
        const why = `seed ${SEED}, edit ${edits} (${what})\nbody=${JSON.stringify(body)}\nprev=${JSON.stringify(prev)}\nout=${JSON.stringify(out)}\nnext=${JSON.stringify(next)}`;
        if (no) {
          refused++;
          expect(next, why).toBe(now);
          continue;
        }
        expect(next.startsWith(front), why).toBe(true);
        expect(roundTrip(next.slice(front.length)), why).toBe(out);
      }
    }
    const ms = performance.now() - t0;
    expect(refused).toBeLessThanOrEqual(3);
    expect(placeStats.fast + placeStats.block + placeStats.refused).toBeGreaterThanOrEqual(edits);
    // Shown with --silent=false: how often the fast path holds.
    console.log(`fuzz: ${edits} edits, fast ${placeStats.fast}, block fallback ${placeStats.block}, refused ${refused}, ${ms.toFixed(0)} ms`);
  });
});
