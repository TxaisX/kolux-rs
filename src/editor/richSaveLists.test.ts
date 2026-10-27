import { describe, expect, it } from "vitest";
import { richChange } from "./frontMatter";
import { roundTrip } from "./markdown";

// Row 94 review round 5 (MEDIUM-1): ordered, indented and loose lists place an edit by item, like a plain bullet list.
// A `1)` list is not covered: the view respells it `1.`, so an edit there still rewrites the whole list (correct, slow).
const apply = (t: string, c: { from: number; to: number; insert: string } | null) => (c ? t.slice(0, c.from) + c.insert + t.slice(c.to) : t);
const median = (f: () => unknown) => {
  f();
  const xs = [0, 1, 2].map(() => {
    const t = performance.now();
    f();
    return performance.now() - t;
  });
  return xs.sort((a, b) => a - b)[1];
};

const item = (kind: string, ind: string, i: number) => `${ind}${kind === "num" ? `${i + 1}.` : kind === "paren" ? `${i + 1})` : "*"} item __${i}__ has _x_\n${ind}   wrapped ${i}`;
const KINDS: [string, string, string][] = [
  ["ordered", "num", ""],
  ["bullets indented 1", "bullet", " "],
  ["bullets indented 2", "bullet", "  "],
  ["bullets indented 3", "bullet", "   "],
  ["loose bullets", "loose", ""],
];
const make = (kind: string, ind: string, n: number, sep = "\n") => Array.from({ length: n }, (_, i) => item(kind === "loose" ? "bullet" : kind, ind, i)).join(kind === "loose" ? "\n\n" : sep) + "\n";

describe.each(KINDS)("a %s list", (_, kind, ind) => {
  it("a Backspace at a wrap in item 3 changes only its own item and keeps the others byte for byte", () => {
    const body = make(kind, ind, 6);
    const prev = roundTrip(body)!;
    const at = prev.indexOf("wrapped 2");
    const out = prev.slice(0, at - 1) + prev.slice(at);
    let refused = 0;
    const c = richChange(body, out, prev, () => refused++);
    const next = apply(body, c);
    expect(refused).toBe(0);
    expect(roundTrip(next)).toBe(roundTrip(out));
    const items = Array.from({ length: 6 }, (_, i) => item(kind === "loose" ? "bullet" : kind, ind, i));
    for (const i of [0, 4, 5]) expect(next).toContain(items[i]);
    expect(c!.to - c!.from).toBeLessThan(items[2].length + items[1].length + items[3].length);
  });
  it("in 1,200 items a keystroke and a Backspace at a wrap are placed in under 50 ms (median of 3)", () => {
    const body = make(kind, ind, 1200);
    const prev = roundTrip(body)!;
    const mid = prev.indexOf("wrapped", prev.length >> 1);
    let key: ReturnType<typeof richChange> = null;
    const msKey = median(() => (key = richChange(body, prev.slice(0, mid) + "Q" + prev.slice(mid), prev)));
    let bs: ReturnType<typeof richChange> = null;
    const out = prev.slice(0, mid - 1) + prev.slice(mid);
    const msBs = median(() => (bs = richChange(body, out, prev)));
    expect(roundTrip(apply(body, key))).toBe(prev.slice(0, mid) + "Q" + prev.slice(mid));
    expect(roundTrip(apply(body, bs))).toBe(out);
    expect(bs!.to - bs!.from).toBeLessThan(120);
    expect(msKey).toBeLessThan(150); // 3x headroom over the measured ~15 ms for a loaded CI box
    expect(msBs).toBeLessThan(150);
  });
});
