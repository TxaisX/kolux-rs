import { describe, expect, it } from "vitest";
import { STEP, capRows, dedupe, moreLabel, moreTitle, restoreFocus } from "./paletteCaps";

const rows = (section: string, n: number) => Array.from({ length: n }, (_, i) => ({ section, label: `${section} ${i}` }));

describe("view-039 palette caps", () => {
  it("50 matches in one section show 20 rows and a 30 more control; asking again adds 20, then the rest", () => {
    const r = capRows(rows("Worktrees", 50));
    expect(r.shown).toHaveLength(STEP);
    expect(moreLabel(r.more.Worktrees)).toBe("30 more");
    const r2 = capRows(rows("Worktrees", 50), { Worktrees: 1 });
    expect([r2.shown.length, r2.more.Worktrees]).toEqual([40, 10]);
    expect(moreTitle(10)).toBe("Show 10 more");
    const r3 = capRows(rows("Worktrees", 50), { Worktrees: 2 });
    expect([r3.shown.length, r3.more.Worktrees]).toEqual([50, undefined]);
  });
  it("sections are capped one by one and a section under the cap has no more control", () => {
    const r = capRows([...rows("Open tabs", 3), ...rows("Projects", 25)]);
    expect(r.shown.filter((x) => x.section === "Open tabs")).toHaveLength(3);
    expect(r.more).toEqual({ Projects: 5 });
  });
  it("a duplicate row never leaves a ghost", () => {
    const a = { section: "Projects", label: "app", hint: "C:/app", dir: "C:/app" };
    expect(dedupe([a, { ...a }, { ...a, hint: "other" }])).toHaveLength(2);
    expect(capRows([a, { ...a }]).shown).toHaveLength(1);
  });
});

describe("view-039 focus return", () => {
  const el = (connected: boolean, log: string[], name: string) => ({ isConnected: connected, focus: () => void log.push(name) });
  it("goes back to the element it came from", () => {
    const log: string[] = [];
    expect(restoreFocus(el(true, log, "prev"), () => el(true, log, "term"))).toBe(true);
    expect(log).toEqual(["prev"]);
  });
  it("else the terminal, else the editor, else nothing", () => {
    const log: string[] = [];
    const find = (m: Record<string, boolean>) => (sel: string) => (m[sel] ? el(true, log, sel) : null);
    restoreFocus(el(false, log, "prev"), find({ ".xterm-helper-textarea": true, ".cm-content": true }));
    restoreFocus(null, find({ ".cm-content": true }));
    expect(log).toEqual([".xterm-helper-textarea", ".cm-content"]);
    expect(restoreFocus(null, find({}))).toBe(false);
  });
  it("a page that cannot look elements up has no fallback and does not throw", () => {
    expect(restoreFocus(null, () => { throw new TypeError("document.querySelector is not a function"); })).toBe(false);
  });
});
