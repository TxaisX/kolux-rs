import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RepoView, draftSave } from "./RepoPage";

test("SET-033: a repository's base branch and workspaces folder show the inherited value until overridden", () => {
  const p = { id: "p1", name: "app", path: "C:/src/app" };
  const html = renderToString(createElement(RepoView, { project: p, globalDir: "C:/Users/me/kolux-rs/workspaces", onSave: () => {} }));
  expect(html).toContain("New workspaces start from");
  expect(html).toContain('placeholder="the default branch"');
  expect(html).toContain('placeholder="C:/Users/me/kolux-rs/workspaces (the global folder)"');
  const own = renderToString(createElement(RepoView, { project: { ...p, base: "develop", workspacesDir: "D:/wt" }, globalDir: "C:/g", onSave: () => {} }));
  expect(own).toContain('value="develop"');
  expect(own).toContain('value="D:/wt"');
});

test("SET-033: a draft is saved only when it changed; viewing or leaving an untouched field writes nothing", () => {
  expect(draftSave(undefined, "")).toBeNull();
  expect(draftSave(null, "  ")).toBeNull();
  expect(draftSave("develop", "develop ")).toBeNull();
  expect(draftSave(undefined, " develop")).toBe("develop");
  expect(draftSave("develop", "")).toBe("");
});
