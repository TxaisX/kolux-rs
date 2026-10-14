import { expect, test } from "vitest";
import { defaultPreset, filterValue, issueSource, queryWords, setFilter, taskQueries } from "./model";

test("GIT-054: picking a filter rewrites its own part of the query, and clearing it removes only that part", () => {
  const q = setFilter(setFilter("crash", "label", "needs review"), "author", "mo");
  expect(q).toBe('crash label:"needs review" author:mo');
  expect(filterValue(q, "label")).toBe("needs review");
  expect(setFilter(q, "label", "")).toBe("crash author:mo");
  expect(setFilter(q, "author", "ana")).toBe('crash label:"needs review" author:ana');
  expect(queryWords(q)).toEqual(["crash", 'label:"needs review"', "author:mo"]);
});

test("GIT-054: review requested by me lists only pull requests waiting on the user", () => {
  const q = setFilter("", "review-requested", "@me");
  expect(q).toBe("is:pr review-requested:@me");
  expect(taskQueries("all", q, ["o/r"])).toEqual(["is:open is:pr review-requested:@me repo:o/r"]);
  expect(setFilter("is:issue bug", "reviewed-by", "mo"), "a pull-request filter turns an issue search into a PR search").toBe("is:pr bug reviewed-by:mo");
  expect(setFilter(q, "review-requested", ""), "clearing keeps the rest").toBe("is:pr");
});

test("GIT-054: a state filter replaces the preset's open state instead of adding a second one", () => {
  const q = setFilter("", "state", "closed");
  expect(q).toBe("is:closed");
  expect(taskQueries("all", q, ["o/r"])).toEqual(["is:issue is:closed repo:o/r", "is:pr is:closed repo:o/r"]);
  expect(setFilter(q, "state", "merged")).toBe("is:pr is:merged");
  expect(filterValue("is:pr is:merged", "state")).toBe("merged");
  expect(setFilter("is:pr is:merged", "state", "")).toBe("is:pr");
});

test("GIT-044: Tasks opens on the saved default preset, All open when none or an unknown one is saved", () => {
  expect(defaultPreset(null)).toBe("all");
  expect(defaultPreset({})).toBe("all");
  expect(defaultPreset({ tasksDefaultPreset: "review" })).toBe("review");
  expect(defaultPreset({ tasksDefaultPreset: "gone" })).toBe("all");
  expect(defaultPreset({ tasksDefaultPreset: 3 })).toBe("all");
});

test("GIT-055: a fork that chose upstream lists its parent's issues and its own PRs; a lost parent warns and falls back", () => {
  const key = "github.com/me/fork";
  const chose = { tasksIssueSource: { [key]: "upstream" } };
  expect(issueSource(chose, key, "me/fork", "up/stream")).toEqual({ repo: "up/stream", warning: null, split: true });
  expect(taskQueries("all", "", ["me/fork"], ["up/stream"])).toEqual(["is:issue is:open repo:up/stream", "is:pr is:open repo:me/fork"]);
  expect(taskQueries("all", "is:issue", ["me/fork"], ["up/stream"])).toEqual(["is:open is:issue repo:up/stream"]);
  const lost = issueSource(chose, key, "me/fork", null);
  expect(lost.repo).toBe("me/fork");
  expect(lost.warning).toMatch(/gone/);
  expect(issueSource(chose, key, "me/fork", undefined), "still checking: the fork itself, no warning yet").toEqual({ repo: "me/fork", warning: null, split: false });
  expect(issueSource({}, key, "me/fork", "up/stream"), "no choice: the fork itself").toEqual({ repo: "me/fork", warning: null, split: false });
  expect(issueSource({ tasksIssueSource: { "github.com/other/x": "upstream" } }, key, "me/fork", "up/stream").repo, "kept per repository").toBe("me/fork");
});
