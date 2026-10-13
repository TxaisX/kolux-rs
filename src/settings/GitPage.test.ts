import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { GitView } from "./GitPage";

const view = (settings: Record<string, unknown>, draft = "", check: { prefix: string; refused: boolean } | null = null) =>
  renderToString(createElement(GitView, { settings, save: () => {}, draft, setDraft: () => {}, check }));

test("T-116-a-fix: the branch prefix, its sample and the default compare base live on Settings > Git & worktrees", () => {
  const html = view({}, "", { prefix: "txais-xiong/", refused: false });
  const card = html.slice(html.indexOf('data-section="branches"'));
  expect(card).toContain("Branch prefix");
  expect(card).toContain('aria-label="branch prefix"');
  expect(card).toMatch(/Next branch: <code>txais-xiong\/&lt;name&gt;<\/code>/);
  expect(card).toContain("Default compare base");
  expect(card).not.toContain("custom branch prefix");
  expect(html.indexOf('data-section="branches"')).toBeLessThan(html.indexOf('data-section="deleting"'));
});

test("T-116-a-fix: a custom prefix shows its field, and a refused one warns", () => {
  const html = view({ branchPrefix: "custom", branchPrefixCustom: "a b", scmSummaryUpstream: true }, "a b", { prefix: "", refused: true });
  expect(html).toContain('aria-label="custom branch prefix"');
  expect(html).toContain('role="alert"');
  expect(html).toContain("Git does not accept");
  expect(html).toMatch(/<option value="upstream" selected="">Branch upstream/);
});
