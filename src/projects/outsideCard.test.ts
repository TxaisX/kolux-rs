import { expect, test } from "vitest";
import { outsideCard, outsideLines, outsideTitle } from "./outsideCard";
import type { Worktree } from "./model";

const wt = (path: string, branch: string | null = null): Worktree => ({ path, branch, head: "abc", isMain: false });
const two = [wt("C:/x/one", "one"), wt("C:/x/two")];

test("a project with outside worktrees gets the card above its rows", () => {
  expect(outsideCard({ outside: two, dismissed: false, collapsed: false, otherRows: 3 })).toEqual({ show: true, count: 2, placement: "above-rows" });
});

test("a dismissed card stays dismissed", () => {
  expect(outsideCard({ outside: two, dismissed: true, collapsed: false, otherRows: 3 }).show).toBe(false);
});

test("collapsing the project group hides the card", () => {
  expect(outsideCard({ outside: two, dismissed: false, collapsed: true, otherRows: 3 }).show).toBe(false);
});

test("a project with no other rows still shows the card, under the header", () => {
  expect(outsideCard({ outside: two, dismissed: false, collapsed: false, otherRows: 0 }).placement).toBe("under-header");
});

test("no outside worktrees, no card", () => {
  expect(outsideCard({ outside: [], dismissed: false, collapsed: false, otherRows: 0 }).show).toBe(false);
});

test("the title counts and the list names each worktree, capped", () => {
  expect(outsideTitle(1)).toBe("1 workspace from outside Kolux");
  expect(outsideTitle(3)).toBe("3 workspaces from outside Kolux");
  const l = outsideLines([...two, ...Array.from({ length: 8 }, (_, i) => wt(`C:/x/n${i}`))]);
  expect(l.lines.length).toBe(8);
  expect(l.more).toBe(2);
  expect(l.lines[0].label).toBe("one");
  expect(l.lines[1].label).toBe("two");
});
