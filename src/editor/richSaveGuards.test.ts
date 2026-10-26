import { describe, expect, it } from "vitest";
import { mapEdit, richBlocker, richBlockerSince, richChange } from "./frontMatter";
import { roundTrip, unsupported } from "./markdown";

// Row 94 review round 4: a saved rich edit never makes the note one the rich view refuses next time (M1), the twin
// re-show catches what a removed fence uncovers (M2), an edit in a big list stays fast (M3) and respells only the
// item it touched (M4), and a quote with a blank `>` line opens in source view.
const apply = (t: string, c: { from: number; to: number; insert: string } | null) => (c ? t.slice(0, c.from) + c.insert + t.slice(c.to) : t);

describe("M1: a placement never leaves a rule or underline the rich view refuses", () => {
  const cases: [string, string, (p: string) => string][] = [
    ["setext ==", "Total score\n== 10 points", (p) => p.replace(" 10 points", "")],
    ["setext --- after delete", "a dash run\n--- then more", (p) => p.replace(" then more", "")],
    ["setext -", "temperature was\n-5 today", (p) => p.replace("5 today", "")],
    ["* * * rule", "stars here\n* * * x", (p) => p.replace(" x", "")],
    ["- - - rule", "item\n- - - y", (p) => p.replace(" y", "")],
    ["reference definition", "see\nthere", (p) => p.replace("see there", "see [r]: u")],
  ];
  it.each(cases)("%s", (_, body, ed) => {
    expect(unsupported(body)).toBeNull();
    const prev = roundTrip(body)!;
    const out = ed(prev);
    const next = mapEdit(body, out, prev);
    if (next === null) return;
    expect(roundTrip(next)).toBe(roundTrip(out));
    if (unsupported(out) === null) expect(unsupported(next)).toBeNull();
  });
});

describe("M2: the twin re-show after a fence opener is deleted", () => {
  const inner = ["<!-- c -->", "![i](x.png)", "***", "[r]: http://x"];
  it.each(inner)("uncovering %s is caught like the full check", (bit) => {
    const before = `a\n\n\`\`\`\nfoo\n\nbar\n\n${bit}\n\`\`\`\n`;
    const text = `a\n\nfoo\n\nbar\n\n${bit}\n\`\`\`\n`;
    expect(richBlocker(before, false)).toBeNull();
    expect(richBlocker(text, false)).not.toBeNull();
    expect(richBlockerSince(before, text, false)).toEqual(richBlocker(text, false));
  });
});

const bigList = Array.from({ length: 1200 }, (_, i) => `* item __${i}__ has _x_\n  wrapped ${i}`).join("\n") + "\n";
const median = (f: () => unknown) => {
  f();
  const xs = [0, 1, 2].map(() => {
    const t = performance.now();
    f();
    return performance.now() - t;
  });
  return xs.sort((a, b) => a - b)[1];
};

describe("M3: a keystroke in a 1,200-item list", () => {
  const prev = roundTrip(bigList)!;
  const mid = prev.indexOf("wrapped", prev.length >> 1);
  it("an ordinary keystroke is placed in well under 60 ms, and only that item changes", () => {
    const out = prev.slice(0, mid) + "Q" + prev.slice(mid);
    let c = null;
    const ms = median(() => (c = richChange(bigList, out, prev)));
    const next = apply(bigList, c);
    expect(roundTrip(next)).toBe(out);
    expect(ms).toBeLessThan(60);
  });
  it("a Backspace at a wrap (the fallback) is under 150 ms and rewrites one item only", () => {
    const out = prev.slice(0, mid - 1) + prev.slice(mid);
    let c: { from: number; to: number; insert: string } | null = null;
    const ms = median(() => (c = richChange(bigList, out, prev)));
    const next = apply(bigList, c);
    expect(roundTrip(next)).toBe(out);
    expect(c!.to - c!.from).toBeLessThan(80);
    expect(ms).toBeLessThan(150);
  });
  it("the twin re-show check is under 60 ms", () => {
    const twin = bigList.slice(0, bigList.length >> 1) + "Z" + bigList.slice(bigList.length >> 1);
    expect(median(() => richBlockerSince(bigList, twin, false))).toBeLessThan(60);
  });
});

describe("M4: the fallback rewrites only the item or section child it touched", () => {
  const items = ["- __a__ one\n  wrap one", "- item _two_\n  wrap two", "- three __x__\n  wrapped", "- four __f__\n  - nested __n__\n    deeper", "- five _v_", "- six __s__\n  end"];
  const body = items.join("\n") + "\n";
  it("a Backspace at the wrap in item 3 keeps items 1, 2, 4, 5 and 6 byte for byte", () => {
    const prev = roundTrip(body)!;
    const at = prev.indexOf("wrapped");
    const out = prev.slice(0, at - 1) + prev.slice(at);
    let refused = 0;
    const next = apply(body, richChange(body, out, prev, () => refused++));
    expect(refused).toBe(0);
    expect(roundTrip(next)).toBe(out);
    const got = next.split(/\n(?=- )/);
    expect(got.length).toBe(6);
    for (const i of [0, 1, 3, 4]) expect(got[i]).toBe(items[i]);
    expect(got[5]).toBe(items[5] + "\n");
  });
  it("inside <details>, an unedited sibling paragraph keeps its spelling", () => {
    const sib = "Sibling __y__ para\nwrapped _here_";
    const sec = `<details>\n<summary>S</summary>\n\nInner __x__\nwrapped on\n\n${sib}\n\n</details>\n`;
    expect(unsupported(sec)).toBeNull();
    const prev = roundTrip(sec)!;
    const at = prev.indexOf("wrapped on");
    const out = prev.slice(0, at - 1) + prev.slice(at);
    let refused = 0;
    const next = apply(sec, richChange(sec, out, prev, () => refused++));
    expect(refused).toBe(0);
    expect(roundTrip(next)).toBe(roundTrip(out));
    expect(next).toContain(sib);
  });
  it("guards: merging items, an ordered list and a loose list still read back as the view's text", () => {
    for (const [b, ed] of [
      [body, (p: string) => p.replace("\n- three", " three")],
      ["1. one __a__\n2. two\n3. three _t_\n4. four\n", (p: string) => p.replace("three", "thr")],
      ["1. one __a__\n2. two\n3. three _t_\n4. four\n", (p: string) => p.replace("\n3. three", " three")],
      ["- a __x__\n\n- b _y_\n\n- c\n", (p: string) => p.replace("b", "bQ")],
      ["- a __x__\n\n- b _y_\n\n- c\n", (p: string) => p.replace(/\n+- b/, " b")],
    ] as const) {
      const prev = roundTrip(b)!;
      const out = roundTrip(ed(prev))!;
      let refused = 0;
      const next = apply(b, richChange(b, out, prev, () => refused++));
      if (refused) expect(next).toBe(b);
      else expect(roundTrip(next)).toBe(out);
    }
  });
});

describe("a block quote with a blank > line opens in source view", () => {
  it("is refused with a reason", () => {
    const body = "> q __one__\n>\n> q _two_\n> wrap";
    expect(unsupported(body)).not.toBeNull();
    expect(richBlocker(body, false)).not.toBeNull();
    expect(unsupported("> q __one__\n> q _two_\n> wrap")).toBeNull();
  });
});
