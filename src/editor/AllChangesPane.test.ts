import { describe, expect, it } from "vitest";
import { entryKey, estimate, WAIT_OVER, type Entry } from "./AllChangesPane";

const e = (over: Partial<Entry>): Entry => ({ path: "C:/r/a.ts", staged: false, code: "M", lines: 10, binary: false, stamp: "x", ...over });

describe("All Changes sections", () => {
  it("keeps a file's staged and unstaged change apart", () => {
    expect(entryKey(e({ staged: true }))).not.toBe(entryKey(e({ staged: false })));
  });
  it("reserves a height that grows with the change up to a ceiling", () => {
    expect(estimate(e({ lines: 10 }))).toBeLessThan(estimate(e({ lines: 100 })));
    expect(estimate(e({ lines: 1000 }))).toBe(estimate(e({ lines: 1500 })));
  });
  it("gives a waiting, binary or image section a small fixed height", () => {
    expect(estimate(e({ lines: WAIT_OVER + 1 }))).toBeLessThan(100);
    expect(estimate(e({ lines: null, binary: true }))).toBeLessThan(100);
    expect(estimate(e({ path: "C:/r/logo.png", lines: null, binary: true }))).toBeLessThan(100);
  });
});
