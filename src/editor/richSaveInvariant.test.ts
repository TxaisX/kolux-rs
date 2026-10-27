import { describe, expect, it } from "vitest";
import { richChange } from "./frontMatter";
import { roundTrip } from "./markdown";
import { A_CASES, B_CASES, C_CASES, SEED_ALT, SEED_CASES, TAIL_PARA } from "./richSaveSeedCases";
import { saveBreaksInvariant } from "./richSaveInvariant";

// Row 94 round 11: a save that moved a byte outside the edit, or an untouched list's loose/tight state, marker or gaps, is refused.
describe("saveBreaksInvariant", () => {
  it("fails when a byte outside the edit window changed", () => {
    const body = "one\n\ntwo\n\nthree\n";
    expect(saveBreaksInvariant(body, "one!\n\ntwo\n\nthree X\n", "one\n\ntwo\n\nthree", "one\n\ntwo\n\nthree X")).toMatch(/outside/);
  });

  it("fails when CRLF line ends outside the edit became LF", () => {
    const body = "one\r\n\r\ntwo\r\n\r\nthree\r\n";
    expect(saveBreaksInvariant(body, "one\n\ntwo\r\n\r\nthree X\r\n", "one\n\ntwo\n\nthree", "one\n\ntwo\n\nthree X")).toMatch(/outside/);
    expect(saveBreaksInvariant(body, "one\r\n\r\ntwo\r\n\r\nthree X\r\n", "one\n\ntwo\n\nthree", "one\n\ntwo\n\nthree X")).toBeNull();
  });

  it("fails when an untouched list went from tight to loose", () => {
    const body = "- a\n- b\n- c\n";
    const prev = "- a\n- b\n- c";
    expect(saveBreaksInvariant(body, "- a\n- b\n\n- c d\n", prev, "- a\n- b\n- c d")).toMatch(/loose/);
  });

  it("fails when an untouched list went from loose to tight", () => {
    const body = "- a\n\n- b\n\n- c\n";
    const prev = "- a\n- b\n- c";
    expect(saveBreaksInvariant(body, "- a\n- b\n\n- c d\n", prev, "- a\n- b\n- c d")).not.toBeNull();
  });

  it("fails when an untouched item changed its marker from + to -", () => {
    expect(saveBreaksInvariant("- a\n+ b\n- c\n", "- a2\n- b\n- c\n", "- a\n- b\n- c", "- a2\n- b\n- c")).not.toBeNull();
  });

  it("fails when joining two lists saves the result loose though the view shows it tight (fuzz 63:170)", () => {
    const body = "- itemitem\n\n nested\n\n deeper]\n\n- threeta\n\n3. 3. gamma\n\n4. |delta\n";
    const prev = "- itemitem\n\n nested\n\n deeper]\n\n- threeta\n\n3. 3. gamma\n4. |delta";
    const out = "- itemitem\n\n nested\n\n deeper]\n\n1. - threeta\n2. 3. gamma\n3. |delta";
    expect(saveBreaksInvariant(body, "- itemitem\n\n nested\n\n deeper]\n1. - threeta\n2. 3. gamma\n\n3. |delta\n", prev, out)).not.toBeNull();
  });

  it("passes when the view edit itself changed the marker", () => {
    const body = "- a\n- b\n- c\n";
    expect(saveBreaksInvariant(body, "- a\n* b\n- c\n", "- a\n- b\n- c", "- a\n* b\n- c")).toBeNull();
  });

  it("passes a normal edit inside an item", () => {
    const body = "- a\n- b\n- c\n\nTail\n";
    expect(saveBreaksInvariant(body, "- a\n- bX\n- c\n\nTail\n", "- a\n- b\n- c\n\nTail", "- a\n- bX\n- c\n\nTail")).toBeNull();
  });

  it("richChange refuses a save the invariant rejects and leaves the note alone", () => {
    // Joining n1 onto its parent: keeping the blank line loosens the outer list, dropping it moves an untouched blank.
    const now = "- a\n  * x\n  - n1\n\n  - n2-\n- b\n";
    const prev = "- a\n    - x\n    - n1\n    - n2-\n- b";
    let refused = false;
    const c = richChange(now, "- a n1\n    - n2-\n- b", prev, () => (refused = true));
    expect(refused).toBe(true);
    expect(c).toBeNull();
  });
});

// Row 94 round 12: two shapes the round 11 corpus never made. (1) A long note with a fenced code block shortly above the edit:
// the slice used to start inside the fence, so the fences flipped and a window of ordinary text counted as code. (2) A list nested
// by two spaces: the item ranges were found with indexOf on text whose indent marked had stripped.
describe("round 12", () => {
  const apply = (t: string, c: { from: number; to: number; insert: string } | null) => (c ? t.slice(0, c.from) + c.insert + t.slice(c.to) : t);
  const saved = (now: string, prev: string, out: string) => {
    let refused = false;
    const c = richChange(now, out, prev, () => (refused = true));
    return refused ? null : apply(now, c);
  };
  const fence = (w: string) => "```\n" + Array.from({ length: 100 }, (_, i) => w + i).join("\n") + "\n```\n";
  const paras = Array.from({ length: 300 }, (_, i) => `para ${i}`).join("\n\n") + "\n";
  type Where = "both" | "above" | "below";
  const frame = (where: Where) => ({
    pre: (where === "below" ? "" : fence("alpha") + "\n") + "Intro\n\n",
    post: "\n\nAfter\n\n" + (where === "above" ? "" : fence("beta") + "\n") + paras,
  });
  const WHERES: Where[] = ["both", "above", "below"];
  const noFront = (s: string) => s.replace(/^---\ntitle: fuzz\n---\n/, "");

  describe("a fenced block above the edit in a note over 400 lines", () => {
    const rows = WHERES.flatMap((w) => SEED_CASES.map((c) => [w, ...c] as const));
    it.each(rows)("%s: %s", (where, name, caseNow, casePrev, caseOut, r4) => {
      const { pre, post } = frame(where);
      const now = pre + noFront(caseNow).replace(/\n$/, "") + post;
      expect(now.split("\n").length).toBeGreaterThan(400);
      const prev = roundTrip(now)!;
      expect(prev).toContain(casePrev);
      const out = prev.replace(casePrev, () => caseOut);
      const got = saved(now, prev, out);
      if (got === null) return;
      expect(got.startsWith(pre) && got.endsWith(post), "bytes outside the case moved").toBe(true);
      const mid = got.slice(pre.length, got.length - post.length);
      const want = [r4, SEED_ALT[name]].filter((x): x is string => typeof x === "string").map((x) => noFront(x).replace(/\n$/, ""));
      expect(want).toContain(mid);
    });

    const listCases = [...A_CASES.map((c) => ["A", ...c] as const), ...B_CASES.map((c) => ["B", ...c] as const), ...C_CASES.map((c) => ["C", ...c] as const)];
    const listRows = WHERES.flatMap((w) => listCases.map((c) => [w, ...c] as const));
    it.each(listRows)("%s: %s %s", (where, kind, _name, note, edit, want) => {
      const { pre, post } = frame(where);
      const mid0 = (note + TAIL_PARA).replace(/\n$/, "");
      const now = pre + mid0 + post;
      const prev = roundTrip(now)!;
      const t = edit(prev);
      expect(t).not.toBe(prev);
      const got = saved(now, prev, roundTrip(t)!);
      if (got === null) return;
      expect(got.startsWith(pre) && got.endsWith(post), "bytes outside the case moved").toBe(true);
      const mid = got.slice(pre.length, got.length - post.length);
      // Group A: the exact numbering is the view's call, but no blank line may appear in a list the file has tight.
      const tight = kind === "A" && !/\n\n/.test(mid.split("\n\nTail")[0]);
      expect(tight || mid === (want + TAIL_PARA).replace(/\n$/, "")).toBe(true);
    });
  });


  describe("a list nested by two spaces keeps the siblings of the edited sub-item", () => {
    const NOTE = "- one\n  - sub _a_\n  - two words\n  - more\n- three\n";
    const VIEW = "- one\n    - sub *a*\n    - two words\n    - more\n- three";
    const crlf = (s: string) => s.replace(/\n/g, "\r\n");
    // The save is a refusal, or it is the note with only the edited line changed.
    const expectKept = (now: string, prev: string, out: string, want: string) => {
      const got = saved(now, prev, out);
      expect(got === null || got === want, JSON.stringify(got)).toBe(true);
    };
    it("view text of the note is as expected", () => {
      expect(roundTrip(NOTE)).toBe(VIEW);
    });
    it("adding a sub-item", () => {
      expectKept(NOTE, VIEW, VIEW.replace("    - more", "    - added\n    - more"), "- one\n  - sub _a_\n  - two words\n  - added\n  - more\n- three\n");
    });
    it("splitting a sub-item (Enter in the middle)", () => {
      expectKept(NOTE, VIEW, VIEW.replace("two words", "two\n    - words"), "- one\n  - sub _a_\n  - two\n  - words\n  - more\n- three\n");
    });
    it("adding a sub-item in a CRLF note", () => {
      expectKept(crlf(NOTE), VIEW, VIEW.replace("    - more", "    - added\n    - more"), crlf("- one\n  - sub _a_\n  - two words\n  - added\n  - more\n- three\n"));
    });
    it("splitting a sub-item in a CRLF note", () => {
      expectKept(crlf(NOTE), VIEW, VIEW.replace("two words", "two\n    - words"), crlf("- one\n  - sub _a_\n  - two\n  - words\n  - more\n- three\n"));
    });
    it("adding a sub-item under front matter with no final line end", () => {
      const now = "---\ntitle: x\n---\n" + NOTE.replace(/\n$/, "");
      const got = saved(now, VIEW, VIEW.replace("    - more", "    - added\n    - more"));
      expect(got === null || got === "---\ntitle: x\n---\n- one\n  - sub _a_\n  - two words\n  - added\n  - more\n- three", JSON.stringify(got)).toBe(true);
    });
    it("splitting a sub-item under front matter with no final line end", () => {
      const now = "---\ntitle: x\n---\n" + NOTE.replace(/\n$/, "");
      const got = saved(now, VIEW, VIEW.replace("two words", "two\n    - words"));
      expect(got === null || got === "---\ntitle: x\n---\n- one\n  - sub _a_\n  - two\n  - words\n  - more\n- three", JSON.stringify(got)).toBe(true);
    });
    it("control: four-space nesting keeps the siblings", () => {
      const four = "- one\n    - sub _a_\n    - two words\n    - more\n- three\n";
      expectKept(four, VIEW, VIEW.replace("    - more", "    - added\n    - more"), "- one\n    - sub _a_\n    - two words\n    - added\n    - more\n- three\n");
    });
  });
  describe("a lone CR and a failing check", () => {
    const lone = "- a\n- b\rc\n- d\n\nTail para here.\n";
    const more = (s: string) => s.replace("Tail para here.", "Tail para here, and more.");
    it("a note holding a lone CR outside the edit is refused, never passed", () => {
      expect(saveBreaksInvariant(lone, more(lone), "- a\n- b\n- d\n\nTail para here.", more("- a\n- b\n- d\n\nTail para here."))).not.toBeNull();
    });
    it("richChange on that note refuses or keeps every byte outside the edit", () => {
      const prev = roundTrip(lone) ?? "";
      const got = richChange(lone, more(prev), prev);
      if (got) expect(lone.slice(0, got.from) + got.insert + lone.slice(got.to)).toContain("- b\rc\n- d\n");
    });
    it("a check that throws is a refusal", () => {
      const clean = lone.replace(/\n$/, "");
      const r = saveBreaksInvariant(lone, more(lone), clean, more(clean));
      expect(r).toContain("could not be checked");
    });
  });
});
