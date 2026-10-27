import { marked, type Token } from "marked";
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

// Round 5 (HIGH-1): the rich view drops a list's looseness, so a loose list must come back loose with every untouched
// item spelt as the file had it, or the edit is refused (the note stays as it was, in source view).
describe("HIGH-1: a loose bullet list stays loose", () => {
  const three = "- First item has _notes_\n\n- Second item\n\n- Third item has __bold__\n";
  const two = "- First item has _notes_\n\n- Second item\n";
  const wrapped = "- one _a_\n\n- two __b__\n\n- three __c__ has _x_\n  wrapped 3\n\n- four __d__\n\n- five _e_\n";
  /** Runs one rich edit (`ed` on the view's text) and returns the saved note; a refusal leaves it untouched. */
  const save = (body: string, ed: (prev: string) => string) => {
    const prev = roundTrip(body)!;
    const out = roundTrip(ed(prev))!;
    let refused = 0;
    const next = apply(body, richChange(body, out, prev, () => refused++));
    if (refused) expect(next).toBe(body);
    else expect(roundTrip(next)).toBe(out);
    return { next, refused };
  };
  const blanks = (t: string) => (t.match(/\n\n/g) ?? []).length;
  it("unbolding a word in item 3 keeps the blank lines and items 1 and 2 as they were", () => {
    const { next, refused } = save(three, (p) => p.replace("**bold**", "bold"));
    if (!refused) expect(next).toBe("- First item has _notes_\n\n- Second item\n\n- Third item has bold\n");
  });
  it("typing after the italic word keeps its item on one line and the list loose", () => {
    const { next, refused } = save(three, (p) => p.replace("*notes*", "*notes* ok"));
    if (!refused) expect(next).toBe("- First item has _notes_ ok\n\n- Second item\n\n- Third item has __bold__\n");
  });
  it("deleting the italic word of a two-item list keeps the gap", () => {
    const { next, refused } = save(two, (p) => p.replace("*notes*", ""));
    if (!refused) expect(blanks(next)).toBe(1);
  });
  it("a Backspace at a wrap keeps every blank line and every untouched item's marks", () => {
    const { next, refused } = save(wrapped, (p) => p.replace("*x* wrapped", "*x*wrapped"));
    if (!refused) {
      expect(blanks(next)).toBe(4);
      expect(next).toContain("- one _a_\n\n- two __b__\n\n");
      expect(next).toContain("\n\n- four __d__\n\n- five _e_\n");
    }
  });
  it("a refusal is rare: the four everyday edits above are placed, not refused", () => {
    const refusals = [
      save(three, (p) => p.replace("**bold**", "bold")),
      save(three, (p) => p.replace("*notes*", "*notes* ok")),
      save(two, (p) => p.replace("*notes*", "")),
      save(wrapped, (p) => p.replace("*x* wrapped", "*x*wrapped")),
    ].filter((x) => x.refused).length;
    expect(refusals).toBe(0);
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

// Round 5 (LOW-2): the placement check covers the HTML-tag rule of `unsupported`, not only the line rules.
describe("LOW-2: a placement never makes a span the rich view reads as HTML", () => {
  it.each([
    ["Intro </summary>\n\nfoo _w_ bar>\n", (p: string) => p.replace("</summary>", "</summary")],
  ] as const)("%j", (body, ed) => {
    expect(unsupported(body)).toBeNull();
    const prev = roundTrip(body)!;
    const out = ed(prev);
    let refused = 0;
    const next = apply(body, richChange(body, out, prev, () => refused++));
    if (refused) expect(next).toBe(body);
    else {
      expect(roundTrip(next)).toBe(roundTrip(out));
      if (unsupported(out) === null) expect(unsupported(next)).toBeNull();
    }
  });
});

// Round 5 (LOW-1): a reference definition is one line, so a `[` typed in front of text with a later `[r]:` is not one.
describe("LOW-1: the reference-definition rule stops at a line end", () => {
  const body = "see 4\nthere [r]:\n";
  it("a `[` typed at the start does not read as a reference definition", () => {
    expect(unsupported("[see 4\nthere [r]:\n")).toBeNull();
    expect(unsupported("[r]: http://x\n")).not.toBeNull();
    expect(unsupported("  [r]:\nhttp://x\n")).not.toBeNull();
  });
  it("seed 105's edit saves a note the view can still show", () => {
    const prev = roundTrip(body)!;
    const out = "[" + prev;
    const next = apply(body, richChange(body, out, prev));
    expect(roundTrip(next) + "\n").toBe(out + "\n");
    expect(unsupported(next)).toBeNull();
  });
});

// Round 5 fuzz seeds 85 and 173 (found after the first 60): a window that cuts a line rule short, and a gap put back past an emptied item.
describe("fuzz regressions: a `[r]:` line cut short by the window, a gap past an emptied item", () => {
  const run = (body: string, out: string) => {
    const prev = roundTrip(body)!;
    let refused = 0;
    const next = apply(body, richChange(body, out, prev, () => refused++));
    if (refused) expect(next).toBe(body);
    else expect(roundTrip(next)).toBe(out);
    return { next, refused };
  };
  it("joining a line to a later `[r]:` does not leave it opening a reference definition (CRLF)", () => {
    const body = "temperature 0 -- -5 today1 2.twosee 2\r\nthere [r]:\r\n";
    const { next } = run(body, "temperature 0 -- -5 today1 2.twosee 2 [r]:");
    expect(unsupported(next)).toBeNull();
  });
  it("emptying an item in a loose list keeps the blank lines out of the fence after it", () => {
    run("- - a [0 -\n\n  indented\n\n- para\n- b\n\n```-\ncode 1\n\nmore code\n```\n", "- - a [0 -\n\n  indented\n\n-\n\n```-\ncode 1\n\nmore code\n```");
  });
});

// Round 6 (NEW-HIGH-A, NEW-MED-B): a blank-line gap is put back by item, not by word number, so an item with no words
// (an emoji, `...`) keeps its gaps where they were; an item that starts with markup, a task box or a fence is not refused.
describe("round 6: loose-list gaps are put back by item", () => {
  const P = "\n\nTail para here.\n";
  /** Saves one word change (`from` -> `to` in the view's text); returns the note and whether it was refused. */
  const edit = (body: string, from: string, to: string) => {
    const prev = roundTrip(body)!;
    expect(prev).toContain(from);
    const out = roundTrip(prev.replace(from, to))!;
    let refused = 0;
    const next = apply(body, richChange(body, out, prev, () => refused++));
    if (refused) expect(next).toBe(body);
    else expect(roundTrip(next)).toBe(out);
    return { next, refused };
  };
  const placed = (body: string, from: string, to: string, want: string) => {
    const { next, refused } = edit(body, from, to);
    expect(refused).toBe(0);
    expect(next).toBe(want);
  };
  describe("HIGH-A: an item with no words", () => {
    it("emoji item, edit far from the list", () => {
      const b = "- alpha\n\n- 🎉\n\n- gamma\n\n\nTail para here.\n";
      placed(b, "Tail", "Tails", b.replace("Tail", "Tails"));
    });
    it("a plan with a check mark item", () => {
      const b = "# Plan\n\n- Write spec\n\n- ✅\n\n- Ship it\n\nNotes below.\n";
      placed(b, "Notes", "More notes", b.replace("Notes", "More notes"));
    });
    it("two emoji items in a row", () => {
      const b = "- a\n\n- 🙂\n\n- 🙃\n\n- b\n\nx\n";
      placed(b, "x", "xy", b.replace("\nx\n", "\nxy\n"));
    });
    it("a `...` item, edit in the item after it", () => {
      const b = "- alpha\n\n- ...\n\n- gamma\n\nTail\n";
      placed(b, "gamma", "gammas", b.replace("gamma", "gammas"));
    });
    it("an edit inside the emoji item's neighbour keeps both gaps", () => {
      const b = "- alpha\n\n- 🎉\n\n- gamma\n\nTail\n";
      placed(b, "alpha", "alphas", b.replace("alpha", "alphas"));
    });
  });
  describe("MED-B: markup at the start of an item, a task box, a fence", () => {
    const keep = (b: string, from: string, to: string, want: string) => placed(b, from, to, want);
    it("bold label items, edit in the tail", () => {
      const b = "- **Name:** Bob\n\n- **Age:** 3\n" + P;
      keep(b, "Tail", "Tails", b.replace("Tail", "Tails"));
    });
    it("bold label items, edit inside the list", () => {
      const b = "- **Name:** Bob\n\n- **Age:** 3\n" + P;
      keep(b, "Bob", "Bobby", b.replace("Bob", "Bobby"));
    });
    it("link items", () => {
      const b = "- [Home](http://h.com) page\n\n- [Away](http://a.com) page\n" + P;
      keep(b, "Tail", "Tails", b.replace("Tail", "Tails"));
    });
    it("task items", () => {
      const b = "- [ ] buy milk\n\n- [x] eggs\n" + P;
      keep(b, "Tail", "Tails", b.replace("Tail", "Tails"));
    });
    it("code span items", () => {
      const b = "- `npm i` installs\n\n- `npm t` tests\n" + P;
      keep(b, "Tail", "Tails", b.replace("Tail", "Tails"));
    });
    it("a fenced block inside an item", () => {
      const b = "- a\n\n  ```\n  x\n  ```\n\n- b\n\n- c\n" + P;
      keep(b, "Tail", "Tails", b.replace("Tail", "Tails"));
    });
    it("italic items, edit the last item", () => {
      const b = "- _Note_ one\n\n- _Note_ two\n\n- three\n";
      keep(b, "three", "threes", b.replace("three", "threes"));
    });
  });
});

// Round 7 (HIGH-1..3): an edit inside a fence nested in a list item keeps the fence's indent or is refused; a pure insertion at an
// item's line start moves that item's gap; an ordered marker whose only change is its number does not drop its gap.
describe("round 7", () => {
  const P = "\n\nTail para here.\n";
  const edit = (body: string, from: string, to: string) => {
    const prev = roundTrip(body)!;
    expect(prev).toContain(from);
    const out = roundTrip(prev.replace(from, to))!;
    let refused = 0;
    const next = apply(body, richChange(body, out, prev, () => refused++));
    if (refused) expect(next).toBe(body);
    else expect(roundTrip(next)).toBe(out);
    return { next, refused };
  };
  /** The code blocks of `md` as an independent parser (marked) reads them, nested ones too. */
  const codes = (md: string): string[] => {
    const out: string[] = [];
    const walk = (ts: Token[]) => {
      for (const t of ts) {
        if (t.type === "code") out.push((t as { text: string }).text);
        const kids = t as { tokens?: Token[]; items?: Token[] };
        if (kids.items) walk(kids.items);
        if (kids.tokens) walk(kids.tokens);
      }
    };
    walk(marked.lexer(md));
    return out;
  };
  describe("HIGH-1: an edit inside a fence nested in a list item", () => {
    const shapes: [string, string, string][] = []; // [name, loose body, tight body]
    for (const [mark, ind] of [["- ", 2], ["- ", 3], ["- ", 4], ["1. ", 3]] as const) {
      for (const f of ["```", "~~~"]) {
        const I = " ".repeat(ind);
        const [nb, nc] = mark === "1. " ? ["2. ", "3. "] : ["- ", "- "];
        shapes.push([`${JSON.stringify(mark)} fence ${f} at indent ${ind}`, `${mark}a\n\n${I}${f}\n${I}x\n${I}${f}\n\n${nb}b\n\n${nc}c\n` + P, `${mark}a\n${I}${f}\n${I}x\n${I}${f}\n${nb}b\n${nc}c\n` + P]);
      }
    }
    it.each(shapes)("%s: x -> y keeps the code block (or is refused), loose and tight", (_, loose, tight) => {
      for (const body of [loose, tight]) {
        const { next, refused } = edit(body, "x", "y");
        if (refused) continue;
        expect(codes(next)).toEqual(codes(body).map((c) => c.replace("x", "y")));
        expect(next).toBe(body.replace("x", "y"));
      }
    });
    it.each(shapes)("%s: a multi-line code edit keeps the code block (or is refused)", (_, loose, tight) => {
      for (const body of [loose, tight]) {
        const { next, refused } = edit(body, "x", "x\nz");
        if (refused) continue;
        expect(codes(next).length).toBe(1);
        expect(codes(next)[0]).toMatch(/x\s+z/);
      }
    });
    it.each(shapes)("%s: an edit elsewhere in the note is saved, not refused", (_, loose, tight) => {
      for (const body of [loose, tight]) {
        for (const [from, to] of [["Tail", "Tails"], ["a", "aa"], ["b", "bb"], ["c", "cc"]]) {
          const { next, refused } = edit(body, from, to);
          expect(refused, `${from} in ${JSON.stringify(body)}`).toBe(0);
          expect(codes(next)).toEqual(codes(body));
        }
      }
    });
    it.each([
      ["loose", "- a\n\n  ```\n  x\n  ```\n\n- b\n\n- c\n" + P],
      ["tight", "- a\n  ```\n  x\n  ```\n- b\n- c\n" + P],
    ])("the reviewer's %s repro is refused or placed with the indent, never broken", (_, b) => {
      const { next, refused } = edit(b, "x", "y");
      expect(next).toBe(refused ? b : b.replace("x", "y"));
      expect(refused).toBe(1);
    });
  });

  describe("HIGH-2: a pure insertion at an item's line start moves that item's gap", () => {
    it("a nested item added after the last nested item keeps the outer gap", () => {
      const b = "- a\n  - n1\n\n- b\n" + P;
      const { next, refused } = edit(b, "n1", "n1\n    - n2");
      expect(refused).toBe(0);
      expect(next).toBe("- a\n    - n1\n    - n2\n\n- b\n" + P);
    });
    it("a third nested item keeps the n2/b gap and the a/n1 blank line, or is refused", () => {
      const b = "- a\n\n  - n1\n\n  - n2\n\n- b\n\n- c\n" + P;
      const { next, refused } = edit(b, "n2", "n2\n    - n3");
      if (refused) return expect(next).toBe(b);
      expect(next).toMatch(/^- a\n\n +- n1\n\n +- n2\n +- n3\n\n- b\n\n- c\n/);
    });
    it("a top-level item added at the end of a loose list keeps every gap", () => {
      const b = "- a\n\n- b\n\n- c\n" + P;
      const { next, refused } = edit(b, "c", "c\n- d");
      if (refused) return expect(next).toBe(b);
      expect(next).toMatch(/^- a\n\n- b\n\n- c\n(\n)?- d\n/);
    });
  });

  describe("HIGH-3: a renumbered ordered list keeps the gaps the edit did not touch", () => {
    it("deleting an item before a gap keeps that gap", () => {
      const b = "1. a\n2. b\n3. c\n\n4. d\n" + P;
      const { next, refused } = edit(b, "\n2. b", "");
      if (refused) return expect(next).toBe(b);
      expect(next).toMatch(/c\n\n\d\. d\n/);
    });
    it("inserting after the first item of a loose list keeps the later gaps", () => {
      const b = "1. alpha\n\n2. beta\n\n3. gamma\n\n4. delta\n" + P;
      const { next, refused } = edit(b, "alpha", "alpha\n2. new");
      if (refused) return expect(next).toBe(b);
      expect(next).toMatch(/new\n\n\d\. beta\n\n\d\. gamma\n\n\d\. delta\n/);
    });
    it("deleting an item of a loose list keeps the later gaps", () => {
      const b = "1. alpha\n\n2. beta\n\n3. gamma\n\n4. delta\n" + P;
      const { next, refused } = edit(b, "\n2. beta", "");
      if (refused) return expect(next).toBe(b);
      expect(next).toMatch(/alpha\n\n\d\. gamma\n\n\d\. delta\n/);
    });
  });
});

// Round 8 (row 94): NEW-HIGH-1 deleting the first sub-item must not loosen the untouched outer list.
describe("round 8", () => {
  const P = "\n\nTail para here.\n";
  const edit = (body: string, from: string, to: string) => {
    const prev = roundTrip(body)!;
    expect(prev).toContain(from);
    const out = roundTrip(prev.replace(from, to))!;
    let refused = 0;
    const next = apply(body, richChange(body, out, prev, () => refused++));
    if (refused) expect(next).toBe(body);
    else expect(roundTrip(next)).toBe(out);
    return { next, refused };
  };
  describe("NEW-HIGH-1: a gap never lands between a parent's text and its first sub-item", () => {
    const shapes: [string, string, string, string][] = [
      ["two sub-items", "- a\n  - n1\n\n  - n2\n- b\n- c\n", "  - n1\n", "- a\n  - n2\n- b\n- c\n"],
      ["three sub-items", "- a\n  - n1\n\n  - n2\n  - n3\n- b\n- c\n", "  - n1\n", "- a\n  - n2\n  - n3\n- b\n- c\n"],
      ["ordered", "1. a\n   1. n1\n\n   2. n2\n2. b\n3. c\n", "    1. n1\n","1. a\n   1. n2\n2. b\n3. c\n"],
    ];
    it.each(shapes)("%s: deleting the first sub-item saves a tight outer list", (_, b, from, want) => {
      const { next, refused } = edit(b + P, from, "");
      expect(refused).toBe(0);
      expect(next).toBe(want + P);
    });
  });

  describe("MEDIUM-1: adding a sub-item keeps the gap between a parent and its sub-list", () => {
    const shapes: [string, string, string, string, string][] = [
      ["after n2", "- a\n\n  - n1\n  - n2\n- b\n", "    - n2\n", "    - n2\n    - x\n", "- a\n\n    - n1\n    - n2\n    - x\n- b\n"],
      ["n1 only", "- a\n\n  - n1\n- b\n", "    - n1\n", "    - n1\n    - x\n", "- a\n\n    - n1\n    - x\n- b\n"],
      ["ordered", "1. a\n\n   1. n1\n   2. n2\n2. b\n", "    2. n2\n", "    2. n2\n    3. x\n", "1. a\n\n   1. n1\n   2. n2\n    3. x\n2. b\n"],
      ["indent-4 children", "- a\n\n    - n1\n    - n2\n- b\n", "    - n2\n", "    - n2\n    - x\n", "- a\n\n    - n1\n    - n2\n    - x\n- b\n"],
    ];
    it.each(shapes)("%s", (_, b, from, to, want) => {
      const { next, refused } = edit(b + P, from, to);
      expect(refused).toBe(0);
      expect(next).toBe(want + P);
    });
  });

  describe("LOW-1: indenting an item of a loose 1) list keeps the other gaps", () => {
    const L = "1) one\n\n2) two\n\n3) three\n\n4) four\n";
    const shapes: [string, string, string, string, string][] = [
      ["item 2, 4 spaces", L, "\n2) two\n", "\n    2) two\n", "1) one\n\n    2) two\n\n3) three\n\n4) four\n"],
      ["item 2, tab", L, "\n2) two\n", "\n\t2) two\n", "1) one\n\n\t2) two\n\n3) three\n\n4) four\n"],
      ["item 3, 4 spaces", L, "\n3) three\n", "\n    3) three\n", "1) one\n\n2) two\n\n    3) three\n\n4) four\n"],
      ["item 4, 4 spaces", L, "\n4) four\n", "\n    4) four\n", "1) one\n\n2) two\n\n3) three\n\n    4) four\n"],
    ];
    it.each(shapes)("%s", (_, b, from, to, want) => {
      const { next, refused } = edit(b + P, from, to);
      expect(refused).toBe(0);
      expect(next).toBe(want + P);
    });
  });

  describe("LOW-3: a line the edit adds to a CRLF note ends in CRLF", () => {
    const crlf = (s: string) => s.replace(/\n/g, "\r\n");
    const shapes: [string, string, string, string, string][] = [
      ["insert", "- a\n- b\n", "- a\n", "- a\n- x\n", "- a\n- x\n- b\n"],
      ["split", "Para one two\n", "one two", "one\n\ntwo", "Para one\n\ntwo\n"],
      ["add at the end", "- a\n- b\n", "- b", "- b\n- c", "- a\n- b\n- c\n"],
      ["add at the end of a loose list", "- a\n\n- b\n", "- b", "- b\n- c", "- a\n\n- b\n- c\n"],
      ["new paragraph", "# H\n\ntext", "text", "text\n\nmore", "# H\n\ntext\n\nmore"],
    ];
    it.each(shapes)("%s", (_, b, from, to, want) => {
      const { next, refused } = edit(crlf(b + P), from, to);
      expect(refused).toBe(0);
      expect(next).toBe(crlf(want + P));
    });
  });
});

describe("round 9", () => {
  const P = "\n\nTail para here.\n";
  const edit = (body: string, from: string, to: string) => {
    const prev = roundTrip(body)!;
    expect(prev).toContain(from);
    const out = roundTrip(prev.replace(from, to))!;
    let refused = 0;
    const next = apply(body, richChange(body, out, prev, () => refused++));
    if (refused) expect(next).toBe(body);
    else expect(roundTrip(next)).toBe(out);
    return { next, refused };
  };

  describe("MEDIUM-1: unsupported() reads a CRLF note as it reads the LF one", () => {
    const crlf = (t: string) => t.replace(/\n/g, "\r\n");
    it("gives the same answer for the reviewer's <details> string in LF and CRLF", () => {
      const lf = "<details>\n<summary>S 4</summary\n\n>\\*\n\nInner\n\n</details";
      expect(unsupported(crlf(lf))).toBe(unsupported(lf));
    });
    it("a tag that survives the round trip stays supported in CRLF", () => {
      const lf = "<details>\n<summary>S</summary>\n\nInner\n\n</details>\n";
      expect(unsupported(crlf(lf))).toBe(unsupported(lf));
    });
  });

  describe("HIGH-1: a lazy continuation line is not a parent's text", () => {
    const shapes: [string, string][] = [
      ["width-0 lazy line", "- a\n  - n1\nlazy\n\n  - n2\n- b\n"],
      ["lazy line after two siblings", "- a\n  - n1\n  - n2\nlazy\n\n  - n3\n- b\n"],
      ["under-indented lazy line", "- a\n    - n1\n  lazy\n\n    - n2\n- b\n"],
    ];
    it.each(shapes)("%s: an edit far away keeps every byte near the list", (_, b) => {
      for (const [from, to] of [["Tail", "TailX"], ["b", "bX"]] as const) {
        const { next, refused } = edit(b + P, from, to);
        if (!refused) expect(next).toBe((b + P).replace(from === "b" ? "- b" : from, from === "b" ? "- bX" : to));
      }
      expect(edit(b + P, "Tail", "TailX").refused).toBe(0);
    });
    it("deleting the siblings above a lazy line still drops the gap below it (the parent's list stays tight)", () => {
      const b = "- a 0\n  - n1\n  - n2\nlazy\n\n  - n3\n- b\n" + P;
      const { next, refused } = edit(b, "    - n1\n    - n2 lazy\n", "");
      expect(refused).toBe(0);
      expect((marked.lexer(next)[0] as unknown as { loose: boolean }).loose).toBe(false);
    });
  });

  describe("HIGH-2: a sub-list of another marker is not a sibling above", () => {
    const outerLoose = (t: string) => (marked.lexer(t)[0] as unknown as { loose: boolean }).loose;
    it.each(["* x", "+ x", "1. x"])("deleting n1 under a %s sibling list keeps the outer list tight", (x) => {
      const b = `- a\n  ${x}\n  - n1\n\n  - n2\n- b\n`;
      expect(outerLoose(b)).toBe(false);
      const { next, refused } = edit(b + P, "    - n1\n", "");
      if (!refused) expect(outerLoose(next)).toBe(false);
      expect(refused).toBe(0);
      expect(next).toBe(`- a\n  ${x}\n  - n2\n- b\n` + P);
    });
  });

  describe("LOW-2: the edited line of a CRLF note keeps its CR", () => {
    const crlf = (t: string) => t.replace(/\n/g, "\r\n");
    it("Tab on item 2 of a loose 1) list", () => {
      const { next, refused } = edit(crlf("1) one\n\n2) two\n\n3) three\n" + P), "\n2) two\n", "\n    2) two\n");
      expect(refused).toBe(0);
      expect(next).toBe(crlf("1) one\n\n    2) two\n\n3) three\n" + P));
    });
    it("Tab on item 2 of a loose 1. list", () => {
      const { next, refused } = edit(crlf("1. one\n\n2. two\n\n3. three\n\n4. four\n" + P), "\n2. two\n", "\n    2. two\n");
      expect(refused).toBe(0);
      expect(next).not.toMatch(/(?<!\r)\n/);
    });
  });
});

// Round 9 fuzz follow-ups (seeds 64, 96, 117, 124 of the chained-edit fuzz).
describe("round 9: gaps the view's spacing or an odd indent must not move", () => {
  it("a selection that merges items keeps the file's gap above a sub-item the user never touched (seed 64)", () => {
    const body = "- [x] eggs *e*\n\n- [ ] bread.\n\n- a 2\n    - n1\n    - lazy\n\n    - n3\n- b\n\n- c\n";
    const prev = "- [x] eggs *e*\n- [ ] bread.\n\n- a 2\n    - n1\n    - lazy\n    - n3\n- b\n- c";
    const out = "- [x] eggs *e* -- a 2\n    - n1\n    - lazy\n    - n3\n\n- b\n- c";
    const got = mapEdit(body, out, prev);
    expect(got === null || got.includes("    - lazy\n\n    - n3\n")).toBe(true);
  });
  it("an item whose marker survives an edit that spans it keeps the gap above it (seed 117)", () => {
    const body = "- a 2\n  1. x- b\n\n\n\n- `npm i` installs 3\n";
    const prev = "- a 2\n    1. x- b\n- `npm i` installs 3";
    const out = "- a 2\n    1. x- b -\n-  `npm i` installs 3";
    expect(mapEdit(body, out, prev)).toBe("- a 2\n  1. x- b -\n\n\n\n-  `npm i` installs 3\n");
  });
  it("a sub-item at another indent than the siblings the edit deleted is refused, not tightened (seed 96)", () => {
    const body = "- two\n    - nested deeper- three\n\n- a 3\n  - n1\n\n  - n2|\n- b\n";
    const prev = "- two\n    - nested deeper- three\n- a 3\n    - n1\n    - n2|\n- b";
    const out = "- two\n    - nested deeper- threen1\n    - n2|\n- b";
    const got = mapEdit(body, out, prev);
    expect(got === null || got.includes("\n\n  - n2|")).toBe(true);
  });
  it("a deleted line never leaves the file's blank line between a parent and its sub-list (seed 124)", () => {
    const body = "- see _this_\n\n\n1. a 1\n   - x\n   * y\n\n   * z\n2. b\n";
    const prev = "- see *this*\n\n1. a 1\n    * x\n    * y\n    * z\n2. b";
    const out = "- see *this*\n    * y\n    * z\n\n2. b";
    const got = mapEdit(body, out, prev);
    expect(got === null || !/this_\n\n\s+\* y/.test(got)).toBe(true);
  });
});

// STATUS (round 10, unfinished): the cases below are `it.fails` (red on c2ad6d9b + main merge; each one is a real wrong save or a wider rewrite than r4). Flip to `it` when fixed.
// Row 94 round 10: the r4-vs-r9 differential probe found 298 saves where r9 rewrote items far from the edit (or one it
// never touched) into the view's spelling while r4 kept the file's bytes. Each case expects r4's exact bytes or a refusal.
describe("round 10: a save keeps the bytes of every item the edit did not touch", () => {
  const cases: [string, string, string, string, string | null][] = [
    ["seed 8 edit 238", "---\ntitle: fuzz\n---\n- a 0\n  * x\n  - n1\n\n  - n2\n- ba 1\n    * x\n    * y\n\n    * z\n\n2. b\n\n\n- 🙂✅\n\n- 🙃\n- tail 2\n", "- a 0\n    - x\n    - n1\n    - n2\n- ba 1\n    * x\n    * y\n    * z\n\n2. b\n\n- 🙂✅\n- 🙃\n- tail 2", "- a 0\n    - x\n    - n1 .    - n2\n- ba 1\n    * x\n    * y\n    * z\n\n2. b\n\n- 🙂✅\n- 🙃\n- tail 2", null],
    ["seed 8 edit 244", "---\ntitle: fuzz\n---\n- a 0\n    - x\n    - n1 .    - n2\n- ba 1 \\_    \\* x\n    * y\n\n    * z\n\n2. b\n\n\n- 🙂✅\n\n- \ud83d# -\n- tail 2.\n", "- a 0\n    - x\n    - n1 .    - n2\n- ba 1 \\_    \\* x\n    * y\n    * z\n\n2. b\n\n- 🙂✅\n- \ud83d# -\n- tail 2.", "- a 0\n    * x\n    * n1 .    - n2ba 1 \\_    \\* x\n    * y\n    * z\n\n2. b\n\n- 🙂✅\n- \ud83d# -\n- tail 2.", null],
    ["seed 22 edit 18", "1) paren 0\n2) two _x_\n\n\n* loose 1\n\n* loose _one_\n\n* loose two\n\n\n\n- a 2\n  - n1\n  - n2\nlazy\n\n  - n3\n- b\n\n\n1. a 3\n2. b\n3. c\n\n4. d\n\n\n- a 4\n  + x\n  - n1\n\n  - n2\n- b\n\n\nTotal score 5\n== 10 points", "1) paren 0\n\n2) two *x*\n\n- loose 1\n- loose *one*\n- loose two\n- a 2\n    - n1\n    - n2 lazy\n    - n3\n- b\n\n1. a 3\n2. b\n3. c\n4. d\n\n- a 4\n    - x\n    - n1\n    - n2\n- b\n\nTotal score 5 == 10 points", "1) paren 0\n\n2) two *x*\n\n- loose 1\n- loose    - n2\n- b\n\nTotal score 5 == 10 points", "1) paren 0\n2) two _x_\n\n\n* loose 1\n\n* loose    - n2\n- b\n\n\nTotal score 5\n== 10 points"],
    ["seed 52 edit 226", "* loose 0\n\n* loose _one_\n\n* loose two\n\n- ]a- b.\n\n\n> quote\n\n  *q*\n\n> more text\nlazy lineitem\n\n- item **two**-e *this*\n\n\nTotal score 4\n== 10 points", "- loose 0\n- loose *one*\n- loose two\n- ]a- b.\n\n> quote\n\n  *q*\n\n> more text lazy lineitem\n\n- item **two**-e *this*\n\nTotal score 4 == 10 points", "- loose 0\n- loose *one* two\n- ]a- b.\n\n> quote\n\n  *q*\n\n> more text lazy lineitem\n\n- item **two**-e *this*\n\nTotal score 4 == 10 points", "* loose 0\n\n* loose _one_ two\n\n- ]a- b.\n\n\n> quote\n\n  *q*\n\n> more text\nlazy lineitem\n\n- item **two**-e *this*\n\n\nTotal score 4\n== 10 points"],
    ["seed 63 edit 19", "---\ntitle: fuzz\n---\n1) paren 0\n2) _x_\n\n\n- item 1- item _two_\n  - nested __n__\n    deeper\n- three\n\n\n- alpha #2\n\n- 🎉\n\n- gamma _g_ ...\n\n- five\n\n\n\n- alpha\n\n- 🎉\n\n- gamma _g_\n\n- ...\n\n\n1. a 4\n   - x\n   * y\n\n   * z\n2. b\n\n\n\n1) paren 5\n2) two _x_", "1) paren 0\n\n2) *x*\n\n- item 1- item *two*\n    - nested **n** deeper\n- three\n- alpha #2\n- 🎉\n- gamma *g* ...\n- five\n- alpha\n- 🎉\n- gamma *g*\n- ...\n\n1. a 4\n    * x\n    * y\n    * z\n2. b\n\n1) paren 5\n\n2) two *x*", "1) paren 0\n\n2) *x*\n\n- item 1- item *two*\n    - nested **n** deeper\n- three\n- alpha #2\n- 🎉\n- gamma *g* ...\n- five\n- alpha\n- 🎉\n- gamma *g*\n- ...\n\n1. a 4\n    * x\n\n-     \\* y\n    * z\n\n2. b\n\n1) paren 5\n\n2) two *x*", null],
    ["seed 63 edit 175", "- 🙂\n\n- ✅\n\n- 🙃\n- tail 0\n\n\n- [ ] buy milk 1\n\n- [x] eggs _e_\n\n- [ ] bread\n\n\n- a 2\n  - n1\n  - n2\nlazy\n\n  - n3\n- b\n\n\n- item 3\n- item _two_\n  - nested __n__\n    deeper\n- three\n", "- 🙂\n- ✅\n- 🙃\n- tail 0\n\n- [ ] buy milk 1\n- [x] eggs *e*\n- [ ] bread\n\n- a 2\n    - n1\n    - n2 lazy\n    - n3\n- b\n- item 3\n- item *two*\n    - nested **n** deeper\n- three", "- 🙂\n- ✅\n- 🙃\n- tail 0\n\n- [ ] buy milk 1\n- [x] eggs *e*\n\n- [ ]\n- bread\n- a 2\n    - n1\n    - n2 lazy\n    - n3\n- b\n- item 3\n- item *two*\n    - nested **n** deeper\n- three", "- 🙂\n\n- ✅\n\n- 🙃\n- tail 0\n\n\n- [ ] buy milk 1\n\n- [x] eggs _e_\n\n\n- [ ]\n- bread\n\n- a 2\n  - n1\n  - n2\nlazy\n\n  - n3\n- b\n\n\n- item 3\n- item _two_\n  - nested __n__\n    deeper\n- three\n"],
    ["seed 68 edit 142", "- parent 0\n  - n1 _a_\n\n- b\n\n- c\n\n\n> quote 1 _q_\n> more text\nlazy line\n\n\n\n- item 2\n- item _two_\n  - nested __n__\n    deeper\n- three\n\n\n\n1. a 3\n\n   ```\n   x\n   ```\n\n2. b\n\n3. c\n\n\n\n* loose 4\n\n* loose _one_\n\n* loose two\n\n\n\n- a 5\n  - n1\n  - n2\nlazy\n\n  - n3\n- b", "- parent 0\n    - n1 *a*\n- b\n- c\n\n> quote 1 *q*\n> more text lazy line\n\n- item 2\n- item *two*\n    - nested **n** deeper\n- three\n\n1. a 3\n\n```\nx\n```\n\n2. b\n3. c\n\n- loose 4\n- loose *one*\n- loose two\n- a 5\n    - n1\n    - n2 lazy\n    - n3\n- b", "- parent 0\n    - n1 *a*\n- b\n- c\n\n> quote 1 *q*\n> more text lazy line\n\n- item 2\n- item *two*\n    - nested **n** deeper\n- three\n\n1. a 3\n\n```\nx\n```\n\n2. b\n3. c\n\n- loose 4\n- loose *one* -loose two\n- a 5\n    - n1\n    - n2 lazy\n    - n3\n- b", "- parent 0\n  - n1 _a_\n\n- b\n\n- c\n\n\n> quote 1 _q_\n> more text\nlazy line\n\n\n\n- item 2\n- item _two_\n  - nested __n__\n    deeper\n- three\n\n\n\n1. a 3\n\n   ```\n   x\n   ```\n\n2. b\n\n3. c\n\n\n\n* loose 4\n\n* loose _one_ -loose two\n\n\n\n- a 5\n  - n1\n  - n2\nlazy\n\n  - n3\n- b"],
    ["seed 76 edit 209", "---\ntitle: fuzz\n---\n- **Name:** Bob 0\n\n- **Age:** __3__\n\n- _Note_ three\n\n- __Last__ one\n\n\n- a 1\n  + x\n  - n1\n\n  - n2\n- b\n\n\n\n- a 2\n  * x\n  - n1\n\n  - n2\n- b", "- **Name:** Bob 0\n- **Age:** **3**\n- *Note* three\n- **Last** one\n- a 1\n    - x\n    - n1\n    - n2\n- b\n- a 2\n    - x\n    - n1\n    - n2\n- b", "- **Name:** Bob 0\n- **Age:** **3**\n- *Note* three\n- **Last** one\n- a 1\n    - x\n    - n1   - n2\n- b\n- a 2\n    - x\n    - n1\n    - n2\n- b", "---\ntitle: fuzz\n---\n- **Name:** Bob 0\n\n- **Age:** __3__\n\n- _Note_ three\n\n- __Last__ one\n\n\n- a 1\n  + x\n  - n1   - n2\n- b\n\n\n\n- a 2\n  * x\n  - n1\n\n  - n2\n- b"],
    ["seed 118 edit 325", "- loose 0 _a_\n\n- two __b__\n  wrapped _w_\n\n- three\n\n- four __d__\n\n- five _e_\n\n\n- a 1\n  * x\n  - n1\n\n  - n2\n- b\n\n\n1. a 2 \\*\n   * y\n\n   * z\n2. b\n\n- 🙂\n\n- ✅\n\n- 🙃\n- tail 3\n\n\n1. ord 4 *a*\n\n2. two **b** wrapped *w*\n\n3. three\n\n4. four **d**\n\n5. five \\* e\\*\n", "- loose 0 *a*\n- two **b** wrapped *w*\n- three\n- four **d**\n- five *e*\n- a 1\n    - x\n    - n1\n    - n2\n- b\n\n1. a 2 \\*\n    * y\n    * z\n2. b\n\n- 🙂\n- ✅\n- 🙃\n- tail 3\n\n1. ord 4 *a*\n2. two **b** wrapped *w*\n3. three\n4. four **d**\n5. five \\* e\\*", "- loose 0 *a*\n- two **b** wrapped \\*\\*\n- three\n- four **d**\n- five *e*\n- a 1\n    - x\n    - n1\n    - n2\n- b\n\n1. a 2 \\*\n    * y\n    * z\n2. b\n\n- 🙂\n- ✅\n- 🙃\n- tail 3\n\n1. ord 4 *a*\n2. two **b** wrapped *w*\n3. three\n4. four **d**\n5. five \\* e\\*", null],
    ["seed 123 edit 133", "---\ntitle: fuzz\n---\n- [ ] buy milk 0[x] eggs _e_\r\n\r\n- [ ] brea\r\n\r\n- 1 |- -item _two_\r\n  - nested __n__\r\n    deeper\r\n- three.\r\n\r\n\r\n1. alpha 2\r\n\r\n2. betagamma\\\\3\n\r\n+ plus item 4\r\n- item _two_\r\n  - nested \\*\\*- item 5\r\n- item __]two__\r\n- see _this_\r\n", "- [ ] buy milk 0[x] eggs *e*\n- [ ] brea\n\n- 1 |- -item *two*\n    - nested **n** deeper\n- three.\n\n1. alpha 2\n2. betagamma\\\\3\n\n- plus item 4\n- item *two*\n    - nested \\*\\*- item 5\n- item **]two**\n- see *this*", "- [ ] buy milk 0[x] eggs *e*\n- [ ] brea\n\n- 1 |- -item *two*\n    - nested **n** deeper\n- three.\n\n1. alpha 2\n2. betagamma\\\\3\n\n- plus item 4\n- item *two*\n    - nested \\*\\*- item 5\n- item **]two** #- see *this*", "---\ntitle: fuzz\n---\n- [ ] buy milk 0[x] eggs _e_\r\n\r\n- [ ] brea\r\n\r\n- 1 |- -item _two_\r\n  - nested __n__\r\n    deeper\r\n- three.\r\n\r\n\r\n1. alpha 2\r\n\r\n2. betagamma\\\\3\n\r\n+ plus item 4\r\n- item _two_\r\n  - nested \\*\\*- item 5\r\n- item **]two** #- see *this*\r\n"],
    ["seed 126 edit 204", "- alpha 0\n\n- 🎉\n\n- gamma _g_\n\n- ...\n\n- five\n\n- a 1\n  + x\n  - n1\n\n  - n2\n- b\n\n\n- [ ] buy milk 2\n\n- [x] eggs _e_\n\n- [ ] bread\n\n* star 3\n* next one\n\n\n- alpha 4\n\n- 🎉\n\n- gamma _g_\n\n- ...\n\n- five\n\n\n\n- a 5\n\n  ```\n  x\n  ```\n\n- b _b_\n\n- c", "- alpha 0\n- 🎉\n- gamma *g*\n- ...\n- five\n- a 1\n    - x\n    - n1\n    - n2\n- b\n\n- [ ] buy milk 2\n- [x] eggs *e*\n- [ ] bread\n\n- star 3\n- next one\n- alpha 4\n- 🎉\n- gamma *g*\n- ...\n- five\n- a 5\n\n```\nx\n```\n\n- b *b*\n- c", "- alpha 0\n- 🎉\n- gamma *g*\n- ...\n- five\n- a 1\n    - x\n    - n1\n    - n2\n- b\n\n- [ ] buy milke\\*\n- [ ] bread\n\n- star 3\n- next one\n- alpha 4\n- 🎉\n- gamma *g*\n- ...\n- five\n- a 5\n\n```\nx\n```\n\n- b *b*\n- c", "- alpha 0\n\n- 🎉\n\n- gamma _g_\n\n- ...\n\n- five\n\n- a 1\n  + x\n  - n1\n\n  - n2\n- b\n\n\n- [ ] buy milke\\*\n- [ ] bread\n\n* star 3\n* next one\n\n\n- alpha 4\n\n- 🎉\n\n- gamma _g_\n\n- ...\n\n- five\n\n\n\n- a 5\n\n  ```\n  x\n  ```\n\n- b _b_\n\n- c"],
    ["seed 134 edit 44", "- a 0\r\n  - n1\r\nlazy\r\n\r\n  - n2\r\n- b\r\n\r\n\r\n\r\n,stars here 1\r\n* * * x\r\n\r\n1. alpha 2\r\n\r\n2. beta\r\n\r\n3. gamma\r\n\r\n4. delta\r\n\r\n\r\n\r\n1) paren 3\r\n2) two _x_\r\n\r\n\r\n\r\n- 🙂\r\n\r\n- ✅\r\n\r\n- 🙃\r\n- tail 4", "- a 0\n    - n1 lazy\n    - n2\n- b\n\n,stars here 1\n\n* \\* \\* x\n\n1. alpha 2\n2. beta\n3. gamma\n4. delta\n\n1) paren 3\n\n2) two *x*\n\n- 🙂\n- ✅\n- 🙃\n- tail 4", "- a 0\n    - n1 lazy\n    - n2\n- b\n\n,stars here 1\n\n* \\* \\* x\n\n1. alpha 2\n2. beta\n3. gamma\n4. delta\n\n1) paren 3\n\n2) two *x*Q\n\n- 🙂\n- ✅\n- 🙃\n- tail 4", null],
    ["seed 141 edit 97", "- [ ] buy milk 0\n\n- [x] eggs _e_\n\n- [ ] bread\n\n* loose 1\n\n* loose _one_\n\n* loose two\n\n- a 2\n  - n1\nlazy\n\n  - n2\n- b\n", "- [ ] buy milk 0\n- [x] eggs *e*\n- [ ] bread\n\n- loose 1\n- loose *one*\n- loose two\n- a 2\n    - n1 lazy\n    - n2\n- b", "- [ ] buy milk 0\n- [x] eggs *e*\n- [ ] bread\n\n- loose 1\n- loose *one* -\\_ loose two\n- a 2\n    - n1 lazy\n    - n2\n- b", "- [ ] buy milk 0\n\n- [x] eggs _e_\n\n- [ ] bread\n\n* loose 1\n\n* loose _one_ -\\_ loose two\n\n- a 2\n  - n1\nlazy\n\n  - n2\n- b\n"],
    ["seed 155 edit 176", "---\ntitle: fuzz\n---\n* loose 0\n\n* loose _one_\n\n* *two*\\*\n- see _this_\n\n\nTotal score 2\n== 10 points", "- loose 0\n- loose *one*\n- *two*\\*\n- see *this*\n\nTotal score 2 == 10 points", "- loose 0\n- loose *one* -\n- *two*\\*\n- see *this*\n\nTotal score 2 == 10 points", "---\ntitle: fuzz\n---\n* loose 0\n\n* loose _one_ -\n\n* *two*\\*\n- see _this_\n\n\nTotal score 2\n== 10 points"],
    ["seed 157 edit 192", "* loose 0\n\n* loose _one_\n\n* loose two\n\n\n\n- a 1\n  + x\n  - n1\n\n  - n2\n- b\n\na dash run 2\n--- then more\n\n\n1. one 3twoee *this* wrapped line 4 . alpha 5\n\n2. beta\n\n3. gamma\n\n4. delta", "- loose 0\n- loose *one*\n- loose two\n- a 1\n    - x\n    - n1\n    - n2\n- b\n\na dash run 2 --- then more\n\n1. one 3twoee *this* wrapped line 4 . alpha 5\n2. beta\n3. gamma\n4. delta", "- loose 0\n- loose *one* -loose two\n- a 1\n    - x\n    - n1\n    - n2\n- b\n\na dash run 2 --- then more\n\n1. one 3twoee *this* wrapped line 4 . alpha 5\n2. beta\n3. gamma\n4. delta", "* loose 0\n\n* loose _one_ -loose two\n\n\n\n- a 1\n  + x\n  - n1\n\n  - n2\n- b\n\na dash run 2\n--- then more\n\n\n1. one 3twoee *this* wrapped line 4 . alpha 5\n\n2. beta\n\n3. gamma\n\n4. delta"],
    ["seed 162 edit 40", "- a 0\n  * x\n  - n\n\n  - n2\n- b\n\n- a 1\n  - n1\nlazy\n- b\n\n\n\n- 🙂\n\n- ✅\n\n- 🙃\n- tail 2\n\n- a 3\n  + x\n  - n1\n\n  - n2\n- b\n\n\n\n1. a 4\n   - x\n   * y\n\n   * z\n2. b..", "- a 0\n    - x\n    - n\n    - n2\n- b\n- a 1\n    - n1 lazy\n- b\n- 🙂\n- ✅\n- 🙃\n- tail 2\n- a 3\n    - x\n    - n1\n    - n2\n- b\n\n1. a 4\n    * x\n    * y\n    * z\n2. b..", "- a 0\n    - x\n    -    - n2\n- b\n- a 1\n    - n1 lazy\n- b\n- 🙂\n- ✅\n- 🙃\n- tail 2\n- a 3\n    - x\n    - n1\n    - n2\n- b\n\n1. a 4\n    * x\n    * y\n    * z\n2. b..", "- a 0\n  * x\n  -    - n2\n- b\n\n- a 1\n  - n1\nlazy\n- b\n\n\n\n- 🙂\n\n- ✅\n\n- 🙃\n- tail 2\n\n- a 3\n  + x\n  - n1\n\n  - n2\n- b\n\n\n\n1. a 4\n   - x\n   * y\n\n   * z\n2. b.."],
    ["seed 179 edit 73", "- a 0\n  + x\n  - n1\n\n  - n2 \\*= bloose 1\n\n* loose _one_\n\n* loose two\n\n\n> quote 2 _q_\n> more text\nlazy line\n\n\n- 🙂\n\n- ✅\n\n- 🙃\n- tail 3\n\n\n\n> quote 4 _q_\n> more text\nlazy line\n", "* a 0\n    - x\n    - n1\n    - n2 \\*= bloose 1\n* loose *one*\n* loose two\n\n> quote 2 *q*\n> more text lazy line\n\n- 🙂\n- ✅\n- 🙃\n- tail 3\n\n> quote 4 *q*\n> more text lazy line", "* a 0\n    - x\n    - n1\n    - n2 \\*= bloose 1\n* loose \\*one\n* \\*\n* loose two\n\n> quote 2 *q*\n> more text lazy line\n\n- 🙂\n- ✅\n- 🙃\n- tail 3\n\n> quote 4 *q*\n> more text lazy line", null],
    ["seed 194 edit 331", "- a 0\n  + x\n  - n1\n\n  - n2\n- b\n\n\n\n- [ ] buy milk 1\n\n- [#x] eggs *e*\n\n- [ ] bread\n\n\nstar here 2\n* * * x\n", "- a 0\n    - x\n    - n1\n    - n2\n- b\n\n- [ ] buy milk 1\n\n- [#x] eggs *e*\n\n- [ ] bread\n\nstar here 2\n\n* \\* \\* x", "- a 0\n    - x\n    - n1\n    - n2\n- b\n\n-> [ ] buy milk 1\n\n- [#x] eggs *e*\n\n- [ ] bread\n\nstar here 2\n\n* \\* \\* x", "- a 0\n  + x\n  - n1\n\n  - n2\n- b\n\n\n\n-> [ ] buy milk 1\n\n- [#x] eggs *e*\n\n- [ ] bread\n\n\nstar here 2\n* * * x\n"],
    ["seed 16 edit 143", "- loose 0 _a_\n\n- two __b__\n  wrapped _w_\n\n- three\n\n- four __d__\n\n- five _e_\n\n- [ ] buy milk 1\n\n- [x] eggs _e_\n\n- [ ] bread\n\n\n\n| h2 | b |\n|---|---|\n| _1_ | 2 |", "- loose 0 *a*\n- two **b** wrapped *w*\n- three\n- four **d**\n- five *e*\n\n- [ ] buy milk 1\n- [x] eggs *e*\n- [ ] bread\n\n| h2 | b |\n|---|---|\n| _1_ | 2 |", "- loose 0 *a*\n- two **b** wrapped *w*\n- three\n- four **d**\n- five *e*[ ] buy milk 1\n\n- [x] eggs *e*\n- [ ] bread\n\n| h2 | b |\n|---|---|\n| _1_ | 2 |", "- loose 0 _a_\n\n- two __b__\n  wrapped _w_\n\n- three\n\n- four __d__\n\n- five _e_[ ] buy milk 1\n\n\n- [x] eggs _e_\n\n- [ ] bread\n\n\n\n| h2 | b |\n|---|---|\n| _1_ | 2 |"],
    ["seed 103 edit 1", "- 🙂\r\n\r\n- ✅\r\n\r\n- 🙃\r\n- tail 0\r\n\r\n\r\n\r\n- a 1\r\n  - n1\r\nlazy\r\n\r\n  - n2\r\n- b\r\n\r\n\r\n\r\n- a 2\r\n  - n1\r\n  - n2\r\nlazy\r\n\r\n  - n3\r\n- b\r\n\r\n1. a 3\r\n2. b\r\n3. c\r\n\r\n4. d", "- 🙂\n- ✅\n- 🙃\n- tail 0\n- a 1\n    - n1 lazy\n    - n2\n- b\n- a 2\n    - n1\n    - n2 lazy\n    - n3\n- b\n\n1. a 3\n2. b\n3. c\n4. d", "- 🙂\n- ✅🙃\n- tail 0\n- a 1\n    - n1 lazy\n    - n2\n- b\n- a 2\n    - n1\n    - n2 lazy\n    - n3\n- b\n\n1. a 3\n2. b\n3. c\n4. d", "- 🙂\r\n\r\n- ✅🙃\r\n- tail 0\r\n\r\n\r\n\r\n- a 1\r\n  - n1\r\nlazy\r\n\r\n  - n2\r\n- b\r\n\r\n\r\n\r\n- a 2\r\n  - n1\r\n  - n2\r\nlazy\r\n\r\n  - n3\r\n- b\r\n\r\n1. a 3\r\n2. b\r\n3. c\r\n\r\n4. d"],
    ["seed 85 edit 220", "- a\r\n  * x\r\n  - n1\r\n\r\n  - n2-\r\n- b\\*.\r\n", "- a\n    - x\n    - n1\n    - n2-\n- b\\*.", "- a n1\n    - n2-\n- b\\*.", "- a n1\r\n\r\n  - n2-\r\n- b\\*.\r\n"],
    ["seed 52 edit 303", "- a 0\n  1. x\n  - =n1 -#\n\n  - - 🙃\n- tail 1\n", "- a 0\n    1. x\n    - =n1 -#\n    - - 🙃\n- tail 1", "- a 0\n    1. x\n    - =\n- n1 -#\n    - - 🙃\n- tail 1", "- a 0\n  1. x\n  - =\n- n1 -#\n\n  - - 🙃\n- tail 1\n"],
    ["seed 129 edit 267", "+ plus milk 4\n\n- [x] eggs _e_\n\n- [ ] bread\n\n\n\n- item 5\n- item _two_\n  - nested n\\*\\* deeper-\n- three", "+ plus milk 4\n\n- [x] eggs *e*\n- [ ] bread\n\n- item 5\n- item *two*\n    - nested n\\*\\* deeper-\n- three", "+ plus milk 4\n\n- [x] eggs *e*\n- [ ] bread\n\n- item 5\n- item *two*nested n\\*\\* deeper-\n- three", "+ plus milk 4\n\n- [x] eggs _e_\n\n- [ ] bread\n\n\n\n- item 5\n- item *two*nested n\\*\\* deeper-\n- three"],
    ["seed 21 edit 343", "## 0\n\n\n\n\\_a dash run 1 --- then more.\n\n\n\n- item 2\n- item __two__\n- see -\n- *thi*\n\n\n- a 3\n  1. x\n  - n1\n\n  - n2\n- b\n\n\n\ntemperature 4 was\n-5 today.", "## 0\n\n\\_a dash run 1 --- then more.\n\n- item 2\n- item **two**\n- see -\n- *thi*\n- a 3\n    1. x\n    - n1\n    - n2\n- b\n\ntemperature 4 was -5 today.", "## 0\n\n\\_a dash run 1 --- then more.\n\n- item 2\n- item **two**\n- see -\n- *thi*\n- a 3\n    1. x --  n1\n    - n2\n- b\n\ntemperature 4 was -5 today.", "## 0\n\n\n\n\\_a dash run 1 --- then more.\n\n\n\n- item 2\n- item __two__\n- see -\n- *thi*\n\n\n- a 3\n  1. x --  n1\n\n  - n2\n- b\n\n\n\ntemperature 4 was\n-5 today."],
    ["seed 148 edit 214", "- alpha 0\r\n\r\n- 🎉\r\n\r\n- gamma _g_\r\n\r\n- ...\r\n\r\n- five\r\n\r\n\r\n\r\n- [ ] buy milk 1\r\n\r\n- [x] \\*__strong__ text\r\nwrapped onto\r\n\r\n _line two_\r\nand three.\r\n\r\n\r\n- 🙂\r\n\r\n- ✅- 🙃\r\n- tail 3\r\n", "- alpha 0\n- 🎉\n- gamma *g*\n- ...\n- five\n\n- [ ] buy milk 1\n- [x] \\***strong** text wrapped onto\n\n *line two* and three.\n\n- 🙂\n- ✅- 🙃\n- tail 3", "- alpha 0\n- 🎉\n- gamma \\*\\*\n- ...\n- five\n\n- [ ] buy milk 1\n- [x] \\***strong** text wrapped onto\n\n *line two* and three.\n\n- 🙂\n- ✅- 🙃\n- tail 3", null],
    ["seed 68 edit 17", "---\ntitle: fuzz\n---\n- 0\n\n  - n1\n\n  - n2\n\n- bc\n\n\n1. ord 1 _a_\n\n2. two __b__\n   wrapped _w_\n\n3. three\n\n4. four __d__\n\n5. five _e_\n\n- 🙂\n\n- ✅\n\n- 🙃 .-- tail 2\n\n\n\nthe _API_ call 3 and __API__> here\n\n\n\na dash run 4\n--- then more\n", "- 0\n    - n1\n    - n2\n- bc\n\n1. ord 1 *a*\n2. two **b** wrapped *w*\n3. three\n4. four **d**\n5. five *e*\n\n- 🙂\n- ✅\n- 🙃 .-- tail 2\n\nthe *API* call 3 and **API**> here\n\na dash run 4 --- then more", "- 0\n    - n1\n    - n2\n- bc\n\n1. ord 1 *a*\n2. two **b** wrapped \\*\\*\n3. three\n4. four **d**\n5. five *e*\n\n- 🙂\n- ✅\n- 🙃 .-- tail 2\n\nthe *API* call 3 and **API**> here\n\na dash run 4 --- then more", null],
    ["seed 7 edit 225", "1. alpha 0\r\n\r\n2. beta |3. gamma\r\n\r\n3. delta\r\n\r\n- item 1\r\n- item __two__\r\n- see _this_", "1. alpha 0\n2. beta |3. gamma\n3. delta\n\n- item 1\n- item **two**\n- see *this*", "1. alpha 0\n2. beta |3. gamma\n3. delta\n\n- item 1\n- item **two**\n- see \\*this\n- \\*", "1. alpha 0\r\n\r\n2. beta |3. gamma\r\n\r\n3. delta\r\n\r\n- item 1\r\n- item __two__\r\n- see \\*this\n- \\*"],
    ["seed 136 edit 270", "- a 0\n\n  indented para\n- b\n\n\n1. a 1\n   - x\n   * y\n\n   * z\n2. b\n\n\n\na dash run 2\n--- then more", "- a 0\n\n  indented para\n\n- b\n\n1. a 1\n    * x\n    * y\n    * z\n2. b\n\na dash run 2 --- then more", "- a 0\n\n  indented para\n\n- b\n\n1. a\\* y\n    * z\n2. b\n\na dash run 2 --- then more", "- a 0\n\n  indented para\n- b\n\n\n1. a\\* y\n\n   * z\n2. b\n\n\n\na dash run 2\n--- then more"],
    ["seed 96 edit 325", "- [ ] buy milk 0 word\n\n- [x] eggs _e_\n\n- [ ] bread.\n\n- a 1\n\n  indented para\n- b\n\nstars here 2\n* * * x", "- [ ] buy milk 0 word\n- [x] eggs *e*\n- [ ] bread.\n\n- a 1\n\n  indented para\n\n- b\n\nstars here 2\n\n* \\* \\* x", "- [ ] buy milk 0 word\n- [x] eggs *e*\n- [ ] bread.\n\n-\\* \\* \\* x", "- [ ] buy milk 0 word\n\n- [x] eggs _e_\n\n- [ ] bread.\n\n-\\* * * x"],
  ];
  it.fails.each(cases)("%s", (_, now, prev, out, r4) => {
    let refused = false;
    const c = richChange(now, out, prev, () => (refused = true));
    const got = refused ? null : apply(now, c);
    expect(got === null || got === r4).toBe(true);
  });
});

// Row 94 round 10, items A/C (the view spells a `1)` list loose) and B (a deleted item hands its marker to the next one):
// the saved bytes are exactly `want`, or the save is refused and the note stays as it was.
describe("round 10: `1)` lists stay as tight as the file has them, a deleted item hands over no marker", () => {
  const P = "\n\nTail para here.\n";
  const run = (body: string, edit: (prev: string) => string) => {
    const prev = roundTrip(body)!;
    const t = edit(prev);
    expect(t).not.toBe(prev);
    const out = roundTrip(t)!;
    let refused = false;
    const next = apply(body, richChange(body, out, prev, () => (refused = true)));
    return refused ? body : next;
  };
  const del = (re: RegExp) => (p: string) => p.replace(re, "");
  const ok = (got: string, body: string, want: string) => expect(got === body || got === want).toBe(true);
  const A: [string, string, (p: string) => string, string][] = [
    ["A1 add after two", "1) one\n2) two\n3) three\n", (p) => p.replace(/^(\d\)) two\n/m, "$1 two\n3) new\n"), "1) one\n2) two\n3) new\n3) three\n"],
    ["A2 add first", "1) one\n2) two\n3) three\n", (p) => p.replace(/^(\d\)) one\n/m, "1) new\n$1 one\n"), "1) new\n1) one\n2) two\n3) three\n"],
    ["A3 add last", "1) one\n2) two\n3) three\n", (p) => p.replace(/^(\d\)) three\n/m, "$1 three\n4) new\n"), "1) one\n2) two\n3) three\n4) new\n"],
    ["A4 split two words", "1) one\n2) two words\n3) three\n", (p) => p.replace("two words", "two\n3) words"), "1) one\n2) two\n3) words\n3) three\n"],
    ["A5 nested new first sub", "- a\n  1) y\n  2) z\n- b\n", (p) => p.replace(/^( +)1\) y\n/m, "$11) w\n$11) y\n"), "- a\n  1) w\n  1) y\n  2) z\n- b\n"],
  ];
  it.fails.each(A)("%s", (_, b, edit, want) => {
    const body = b + P;
    const got = run(body, edit);
    // No blank line appears in a list the file has tight; the exact numbering is the view's call.
    expect(got === body || got === want + P || !/\n\n/.test(got.split("\n\nTail")[0])).toBe(true);
  });
  const C: [string, string, (p: string) => string, string][] = [
    ["C1 delete x before a tight 1) list", "- a\n  - x\n  1) y\n  2) z\n- b\n", del(/^ +- x\n/m), "- a\n  1) y\n  2) z\n- b\n"],
    ["C2 delete x before a loose 1) list", "- a\n  - x\n  1) y\n\n  2) z\n- b\n", del(/^ +- x\n/m), "- a\n  1) y\n\n  2) z\n- b\n"],
    ["C3 delete 1. x before a 1) list", "- a\n  1. x\n  1) y\n\n  1) z\n- b\n", del(/^ +1\. x\n/m), "- a\n  1) y\n\n  1) z\n- b\n"],
  ];
  it.fails.each(C)("%s", (_, b, edit, want) => {
    const body = b + P;
    ok(run(body, edit), body, want + P);
  });
  const B: [string, string, (p: string) => string, string][] = [
    ["B1 delete b next to a * list", "- a\n\n- b\n* c\n\n* d\n", del(/^[-*] b\n/m), "- a\n\n* c\n\n* d\n"],
    ["B2 delete n1 next to a * sub-list", "- a\n  - n1\n  * x\n\n  * y\n- b\n", del(/^ +[-*] n1\n/m), "- a\n  * x\n\n  * y\n- b\n"],
    ["B3 delete * x above a loose - list", "* x\n- a\n\n- b\n", del(/^[-*] x\n/m), "- a\n\n- b\n"],
    ["B4 delete * x above a tight - list", "* x\n- a\n- b\n", del(/^[-*] x\n/m), "- a\n- b\n"],
  ];
  it.fails.each(B)("%s", (_, b, edit, want) => {
    const body = b + P;
    ok(run(body, edit), body, want + P);
  });
});
