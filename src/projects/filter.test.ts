// PROJ-052: the workspace list filters.
import { expect, test } from "vitest";
import { CLEAR_FILTERS, FILTER_DEFAULT_SETTING, FILTER_PROJECTS_SETTING, FILTER_SLEEPING_DEFAULT_SETTING, RETIRED_ACTIVE_ONLY, filtersFrom, filtersOn, isDefaultRow, rowShown, toggleProject } from "./filter";
import { SHOW_SLEEPING_SETTING } from "./rows";

const main = { projectId: "p", isMain: true, branch: "main", asleep: false };
const feat = { projectId: "p", isMain: false, branch: "feat", asleep: false };

test("a fresh profile filters nothing", () => {
  const f = filtersFrom({});
  expect(filtersOn(f)).toBe(0);
  expect(rowShown(f, main) && rowShown(f, feat) && rowShown(f, { ...feat, asleep: true })).toBe(true);
});

test("hiding sleeping workspaces while the main checkout is asleep still shows the main checkout", () => {
  const f = filtersFrom({ [SHOW_SLEEPING_SETTING]: false });
  expect(rowShown(f, { ...main, asleep: true })).toBe(true);
  expect(rowShown(f, { ...feat, asleep: true })).toBe(false);
  expect(rowShown(filtersFrom({ [SHOW_SLEEPING_SETTING]: false, [FILTER_SLEEPING_DEFAULT_SETTING]: true }), { ...main, asleep: true })).toBe(false);
});

test("only a main checkout backed by a branch is the default-branch row; a folder project never is", () => {
  expect(isDefaultRow(main)).toBe(true);
  expect(isDefaultRow({ isMain: true, branch: null })).toBe(false);
  expect(isDefaultRow({ isMain: false, branch: "x" })).toBe(false);
  const f = filtersFrom({ [FILTER_DEFAULT_SETTING]: true });
  expect(rowShown(f, main)).toBe(false);
  expect(rowShown(f, { ...main, branch: null })).toBe(true);
  expect(rowShown(f, feat)).toBe(true);
});

test("showing only some projects hides the rest", () => {
  const f = filtersFrom({ [FILTER_PROJECTS_SETTING]: ["q"] });
  expect(rowShown(f, feat)).toBe(false);
  expect(rowShown(f, { ...feat, projectId: "q" })).toBe(true);
  expect(toggleProject(filtersFrom({}), ["p", "q", "r"], "q")).toEqual(["p", "r"]);
  expect(toggleProject(filtersFrom({ [FILTER_PROJECTS_SETTING]: ["p", "r"] }), ["p", "q", "r"], "q")).toEqual([]);
  expect(toggleProject(filtersFrom({ [FILTER_PROJECTS_SETTING]: ["p"] }), ["p", "q"], "p")).toEqual([]);
});

test("one control clears every filter and every row returns", () => {
  const on = { [SHOW_SLEEPING_SETTING]: false, [FILTER_DEFAULT_SETTING]: true, [FILTER_PROJECTS_SETTING]: ["q"] };
  expect(filtersOn(filtersFrom(on))).toBe(3);
  const cleared = { ...on, ...Object.fromEntries(CLEAR_FILTERS) };
  const f = filtersFrom(cleared);
  expect(filtersOn(f)).toBe(0);
  expect([main, feat, { ...feat, asleep: true }].every((r) => rowShown(f, r))).toBe(true);
});

test("the retired active-only filter in an old settings file is not brought back", () => {
  const f = filtersFrom({ [RETIRED_ACTIVE_ONLY]: true });
  expect(filtersOn(f)).toBe(0);
  expect(rowShown(f, feat)).toBe(true);
});
