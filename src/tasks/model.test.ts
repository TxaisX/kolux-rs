import { describe, expect, it, test } from "vitest";
import { beyondWindow, eventLine, pageButtons, pageCount, PRESETS, taskKind, taskQueries, relabel, tasksRepo, withEdits } from "./model";

const projects = [
  { id: "a", name: "Alpha", path: "G:/r/alpha" },
  { id: "b", name: "Beta", path: "G:/r/beta" },
];

test("VIEW-010: the Tasks page reads the workspace on screen, else the first project, else nothing", () => {
  expect(tasksRepo(projects, "G:/r/beta")).toEqual({ dir: "G:/r/beta", name: "Beta" });
  expect(tasksRepo(projects, "G:/ws/beta/helper")).toEqual({ dir: "G:/ws/beta/helper", name: "helper" });
  expect(tasksRepo(projects, null)).toEqual({ dir: "G:/r/alpha", name: "Alpha" });
  expect(tasksRepo([], null)).toBeNull();
});

test("VIEW-010: each row says whether it is an issue, a pull request or a draft", () => {
  const t = { kind: "pr", number: 9, title: "Fix", url: "", repo: "o/r", state: "open", updated: "", draft: true, labels: [], assignees: [], checks: null };
  expect(taskKind(t)).toBe("Draft pull request #9");
  expect(taskKind({ ...t, draft: false })).toBe("Pull request #9");
  expect(taskKind({ ...t, kind: "issue", draft: false, number: 3 })).toBe("Issue #3");
});

test("GIT-043: the preset sets issues, pull requests or both, and a typed is:pr or is:issue wins", () => {
  expect(PRESETS[0].id).toBe("all");
  expect(taskQueries("all", "", ["o/r"])).toEqual(["is:issue is:open repo:o/r", "is:pr is:open repo:o/r"]);
  expect(taskQueries("assigned", "", ["o/r"])).toEqual(["is:issue is:open assignee:@me repo:o/r", "is:pr is:open assignee:@me repo:o/r"]);
  expect(taskQueries("assigned", "is:pr", ["o/r"])).toEqual(["is:open assignee:@me is:pr repo:o/r"]);
  expect(taskQueries("review", "", ["o/r"])).toEqual(["is:pr is:open review-requested:@me repo:o/r"]);
  expect(taskQueries("review", "is:issue crash", ["o/r"])).toEqual(["is:open review-requested:@me is:issue crash repo:o/r"]);
  expect(taskQueries("all", "  label:bug  ", ["o/r", "o/s"])).toEqual(["is:issue is:open label:bug repo:o/r repo:o/s", "is:pr is:open label:bug repo:o/r repo:o/s"]);
  expect(taskQueries("all", "", [])).toEqual([]);
});

test("GIT-043: pages stop at GitHub's 1000-result search window, and the buttons fold around the current page", () => {
  expect(pageCount(0)).toBe(1);
  expect(pageCount(25)).toBe(1);
  expect(pageCount(26)).toBe(2);
  expect(pageCount(5000)).toBe(40);
  expect(beyondWindow(1000)).toBe(false);
  expect(beyondWindow(1001)).toBe(true);
  expect(pageButtons(1, 3)).toEqual([1, 2, 3]);
  expect(pageButtons(10, 40)).toEqual([1, null, 8, 9, 10, 11, 12, null, 40]);
  expect(pageButtons(2, 40)).toEqual([1, 2, 3, 4, null, 40]);
});

test("GIT-050: the preview's timeline says each event in words", () => {
  const e = (kind: string, actor: string, detail = "") => eventLine({ kind, actor, at: "", detail });
  expect(e("labeled", "txais", "bug")).toBe("@txais added the label bug");
  expect(e("unlabeled", "txais", "bug")).toBe("@txais removed the label bug");
  expect(e("assigned", "txais", "txais")).toBe("@txais self-assigned this");
  expect(e("assigned", "txais", "mo")).toBe("@txais assigned @mo");
  expect(e("closed", "mo")).toBe("@mo closed this");
  expect(e("reopened", "mo")).toBe("@mo reopened this");
  expect(e("mentioned", "mo")).toBe("@mo was mentioned");
  expect(e("commented", "mo", "Same here.")).toBe("@mo commented: Same here.");
  expect(e("renamed", "mo", "Crsh → Crash")).toBe("@mo renamed this: Crsh → Crash");
  expect(e("head_ref_deleted", "")).toBe("head ref deleted");
});

describe("GIT-048: label edits show at once and do not flip back", () => {
  const bug = { name: "bug", color: "d73a4a" };
  const docs = { name: "docs", color: "0075ca" };
  const ui = { name: "ui", color: "" };
  it("two quick additions both stay, and undoing one failed edit leaves the other", () => {
    const one = relabel([ui], ["bug"], [], [bug, docs]);
    const two = relabel(one, ["docs"], [], [bug, docs]);
    expect(two).toEqual([ui, bug, docs]);
    expect(relabel(two, [], ["bug"], [bug, docs])).toEqual([ui, docs]);
    expect(relabel(two, ["bug"], ["ui"], [])).toEqual([bug, docs]);
  });
  it("a late search page still carrying the old labels does not undo an edit", () => {
    const item = { kind: "issue", number: 1, title: "t", url: "u1", repo: "a/b", state: "open", draft: false, labels: [ui], assignees: [], updated: "", checks: null };
    const page = { total: 2, deepest: 2, items: [item, { ...item, url: "u2" }] };
    const out = withEdits(page, new Map([["u1", [ui, bug]]]));
    expect(out.items.map((t) => t.labels)).toEqual([[ui, bug], [ui]]);
    expect(withEdits(page, new Map()).items[0].labels).toEqual([ui]);
  });
});
