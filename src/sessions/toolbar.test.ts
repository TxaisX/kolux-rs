import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import AgentsPanel from "./AgentsPanel";
import { remember } from "./refresh";

const row = (over: Record<string, unknown> = {}) => ({ agent: "claude", id: "s1", title: "Fix login", modifiedMs: Date.now() - 120_000, bytes: 10, turns: 2, dir: "C:/w/a", ...over });
const props = (settings: Record<string, unknown>) => ({ settings, onSave: () => {}, activeDir: "C:/w/a", projectDirs: [], projects: [{ path: "C:/w" }], rescanKey: 0, visible: true, shell: null, onResume: () => {} });
const cache = (depth: number | null, rows: unknown[]) => remember(JSON.stringify([false, ["C:/w/a"], depth]), rows);

test("VIEW-081: the toolbar has a search box and a scope picker with the three scopes", () => {
  cache(200, [row()]);
  const html = renderToString(createElement(AgentsPanel, props({})));
  expect(html).toContain("Search past sessions");
  expect(html).toContain("This workspace");
  expect(html).toContain("This project");
  expect(html).toContain("All sessions");
  expect(html).toContain(">Options<");
});

test("VIEW-082: changed options show their count on the Options button; saved grouping draws group headers", () => {
  cache(null, [row(), row({ id: "s2", agent: "codex", dir: "C:/w/b", title: "Other" })]);
  const html = renderToString(createElement(AgentsPanel, props({ sessionListView: { group: "agent", depth: null } }))).replace(/<!-- -->/g, "");
  expect(html).toContain("Options (2)");
  expect(html).toContain("claude (1)");
  expect(html).toContain("codex (1)");
});

test("VIEW-082: hidden agents and hide-empty narrow the list and the count says how many of how many", () => {
  cache(200, [row(), row({ id: "s2", agent: "codex", title: "Other" }), row({ id: "s3", title: "", turns: 0 })]);
  const html = renderToString(createElement(AgentsPanel, props({ sessionListView: { hiddenAgents: ["codex"], hideEmpty: true } })));
  expect(html).toContain("1 of 3 past sessions");
  expect(html).not.toContain("Other");
});

test("VIEW-080: a manual all stays all even with a workspace in front", () => {
  remember(JSON.stringify([true, [], 200]), [row({ id: "z", title: "From anywhere" })]);
  const html = renderToString(createElement(AgentsPanel, props({ sessionListScope: { scope: "all", manual: true } })));
  expect(html).toContain("From anywhere");
});
