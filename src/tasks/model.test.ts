import { expect, test } from "vitest";
import { taskKind, tasksRepo } from "./model";

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
  const t = { kind: "pr", number: 9, title: "Fix", url: "", state: "OPEN", updated: "", draft: true };
  expect(taskKind(t)).toBe("Draft pull request #9");
  expect(taskKind({ ...t, draft: false })).toBe("Pull request #9");
  expect(taskKind({ ...t, kind: "issue", draft: false, number: 3 })).toBe("Issue #3");
});
