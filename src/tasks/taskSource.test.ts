import { expect, test } from "vitest";
import { taskSource } from "./taskSource";

test("ACCT-057: GitHub is the source, shown with the signed-in account", () => {
  expect(taskSource({}, "octo")).toEqual({ id: "github", name: "GitHub", available: true, fellBack: false, text: "GitHub · @octo" });
  expect(taskSource(null, "octo").id).toBe("github");
});

test("ACCT-057: a signed-out GitHub CLI shows GitHub as unavailable instead of failing", () => {
  const v = taskSource({}, null);
  expect(v).toMatchObject({ id: "github", available: false });
  expect(v.text).toBe("GitHub · unavailable: the GitHub CLI is signed out");
  expect(taskSource({}, undefined).text).toBe("GitHub · checking");
});

test("ACCT-057: a saved source that is gone, unknown or hidden falls back to GitHub", () => {
  expect(taskSource({ tasksSource: "linear" }, "octo")).toMatchObject({ id: "github", fellBack: true });
  expect(taskSource({ tasksSource: 7 }, "octo")).toMatchObject({ id: "github", fellBack: true });
  expect(taskSource({ tasksSource: "github" }, "octo", ["github"])).toMatchObject({ id: "github", fellBack: true });
  expect(taskSource({ tasksSource: "github" }, "octo")).toMatchObject({ id: "github", fellBack: false });
  expect(taskSource({ tasksSource: "" }, "octo").fellBack).toBe(false);
});
