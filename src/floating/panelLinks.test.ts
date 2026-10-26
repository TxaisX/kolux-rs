import { expect, test } from "vitest";
import { add, empty, hide, openLink, select } from "./panel";

// APP-015 (T-248-c): a link clicked in the floating panel opens in the panel, never in the window's worktree tabs.
const withTerminal = () => add(empty(), { kind: "terminal" });

test("a web link opens as a browser tab of the panel, selected and focused, titled by its site", () => {
  const p = openLink(withTerminal(), "https://example.com/docs?a=1");
  const tab = p.tabs[p.tabs.length - 1];
  expect(tab).toMatchObject({ kind: "browser", path: "https://example.com/docs?a=1", title: "example.com" });
  expect(p.active).toBe(tab.key);
  expect(p.focus).toBe(tab.key);
  expect(p.tabs).toHaveLength(2);
});

test("a hidden panel is shown by the link, so it never opens somewhere unseen", () => {
  const p = openLink(hide(withTerminal()), "http://localhost:3000/");
  expect(p.open).toBe(true);
});

test("the same address opens one tab: the second click selects it", () => {
  let p = openLink(withTerminal(), "https://example.com/");
  const first = p.active!;
  p = select(p, p.tabs[0].key);
  p = openLink(p, "https://example.com/");
  expect(p.tabs).toHaveLength(2);
  expect(p.active).toBe(first);
});

test("only web addresses open; file, javascript and malformed text leave the panel as it was", () => {
  const p = withTerminal();
  for (const u of ["file:///C:/a.txt", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "not a url", ""]) expect(openLink(p, u)).toBe(p);
});

test("opening a link adds no terminal and no folder: the panel's other tabs are untouched", () => {
  const p0 = withTerminal();
  const p = openLink(p0, "https://example.com/");
  expect(p.tabs[0]).toEqual(p0.tabs[0]);
  expect(p.tabs[1].cwd).toBeUndefined();
});
