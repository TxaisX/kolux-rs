import { expect, test } from "vitest";
import { marksUnread, tabBadge } from "./tabs";

test("a tab shows one badge: spinner, question mark, bell or check; an idle shell shows none (TERM-055)", () => {
  expect(tabBadge("claude", undefined, false, false)).toBe("working");
  expect(tabBadge("claude", true, false, false)).toBe("working");
  expect(tabBadge("claude", true, true, false)).toBe("permission");
  expect(tabBadge("claude", false, false, true)).toBe("unread");
  expect(tabBadge("claude", false, false, false)).toBe("done");
  expect(tabBadge("shell", true, false, false)).toBeNull();
  expect(tabBadge("shell", undefined, false, false)).toBeNull();
  expect(tabBadge("shell", true, false, true)).toBe("unread");
});

test("a finish or bell marks the pane unread unless it is in view in a focused window; late events are dropped (TERM-118)", () => {
  const known = new Set([1, 2]);
  expect(marksUnread(2, known, new Set(), false, true)).toBe(true); // a hidden tab or split pane
  expect(marksUnread(1, known, new Set(), true, false)).toBe(true); // Kolux in the background
  expect(marksUnread(1, known, new Set(), true, true)).toBe(false); // the pane being looked at
  expect(marksUnread(3, known, new Set(), false, true)).toBe(false); // the pane is gone
  expect(marksUnread(2, known, new Set([2]), false, true)).toBe(false); // already marked
});

test("a running agent whose hook says done shows the check, or the bell when unread; a question wins (STAT-001)", () => {
  expect(tabBadge("claude", true, false, false, "done")).toBe("done");
  expect(tabBadge("claude", true, false, true, "done")).toBe("unread");
  expect(tabBadge("claude", true, true, false, "done")).toBe("permission");
  expect(tabBadge("claude", true, false, false, "working")).toBe("working");
  expect(tabBadge("claude", true, false, false, "permission")).toBe("working");
});
