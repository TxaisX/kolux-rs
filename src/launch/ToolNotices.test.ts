// APP-023: the landing screen's notices for missing or signed-out tools.
import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { toolNotices, type Tools } from "./toolChecks";
import { ToolNoticesView } from "./ToolNotices";

const all: Tools = { git: "ok", gh: "ok", ghSignedIn: "ok", glab: "ok", githubProjects: [], gitlabProjects: [], dismissed: {} };
const ids = (t: Partial<Tools>, agents: boolean | null = true) => toolNotices({ ...all, ...t }, agents).map((n) => n.id);

test("APP-023: Git missing always shows; GitHub's program only once a GitHub project exists", () => {
  expect(ids({})).toEqual([]);
  expect(ids({ git: "missing" })).toEqual(["git"]);
  expect(ids({ gh: "missing" })).toEqual([]);
  expect(ids({ gh: "missing", githubProjects: ["p1"] })).toEqual(["gh"]);
  expect(ids({ ghSignedIn: "missing", githubProjects: ["p1"] })).toEqual(["gh-signin"]);
  expect(ids({ glab: "missing" })).toEqual([]);
  expect(ids({ glab: "missing", gitlabProjects: ["p2"] })).toEqual(["glab"]);
});

test("APP-023: a hung probe (unknown) shows nothing; no AI program at all shows once agents are read", () => {
  expect(ids({ git: "unknown", gh: "unknown", ghSignedIn: "unknown", githubProjects: ["p1"] })).toEqual([]);
  expect(ids({}, false)).toEqual(["agents"]);
  expect(ids({}, null)).toEqual([]);
});

test("APP-023: a dismissed notice stays hidden until the GitHub project set changes", () => {
  const t = { gh: "missing" as const, githubProjects: ["a", "b"], dismissed: { gh: "a,b" } };
  expect(ids(t)).toEqual([]);
  expect(ids({ ...t, githubProjects: ["a", "b", "c"] })).toEqual(["gh"]);
  expect(ids({ git: "missing", dismissed: { git: "" } })).toEqual([]);
  expect(ids({ git: "missing", githubProjects: ["a"], dismissed: { git: "" } })).toEqual(["git"]);
});

test("APP-023: each notice has Check again and Dismiss", () => {
  const notices = toolNotices({ ...all, git: "missing" }, false);
  const html = renderToString(createElement(ToolNoticesView, { notices, busy: false, onDismiss: () => {}, onRefresh: () => {} }));
  expect(html).toContain("Git is not installed");
  expect(html).toContain("No AI program");
  expect(html.match(/>Dismiss</g)).toHaveLength(2);
  expect(html.match(/>Check again</g)).toHaveLength(2);
  expect(renderToString(createElement(ToolNoticesView, { notices: [], busy: false, onDismiss: () => {}, onRefresh: () => {} }))).toBe("");
});
