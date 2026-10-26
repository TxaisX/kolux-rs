import { describe, expect, it } from "vitest";
import { CLEAR_FILTERS, FILTER_DEFAULT_SETTING, FILTER_PROJECTS_SETTING, filtersFrom, toggleProject } from "./filter";
import { applySetting, pendingWrites, type Settings } from "./settingWrite";
import { settingsDiff } from "../settings/saveChanged";

// Stands in for App and the Projects panel: state moves only on render, the ref follows each render
// (as App.settingsRef does), and every save goes to a fake disk as a diff (as saveChanged does).
function fakeApp(initial: Settings) {
  let state = initial;
  let queued = initial;
  const cell = { current: initial };
  const panel = pendingWrites();
  const disk: Settings = { ...initial };
  return {
    render() {
      state = queued;
      cell.current = state;
      panel.reset();
    },
    get state() {
      return state;
    },
    disk,
    // App.saveSetting
    saveSetting(key: string, value: unknown) {
      const { was, next } = applySetting(cell, key, value);
      queued = next;
      Object.assign(disk, settingsDiff(was, next).set);
    },
    // ProjectsPanel.setFilter, and the tick on a project's box
    setFilter(key: string, value: unknown) {
      panel.put(key, value);
      this.saveSetting(key, value);
    },
    clear() {
      CLEAR_FILTERS.forEach(([k, v]) => this.setFilter(k, v));
    },
    tick(id: string) {
      this.setFilter(FILTER_PROJECTS_SETTING, toggleProject(filtersFrom(panel.latest(state)), ALL, id));
    },
  };
}

const ALL = ["p1", "p2", "p3", "p4"];

describe("settings writes before a render (after-list row 794)", () => {
  const start = { [FILTER_PROJECTS_SETTING]: ["p1"], [FILTER_DEFAULT_SETTING]: true, showSleeping: false, other: 1 };

  it("a tick right after Clear filters builds on the cleared filters", () => {
    const app = fakeApp(start);
    app.render();
    app.clear();
    app.tick("p3");
    app.render();
    expect(filtersFrom(app.state).projects).toEqual(["p1", "p2", "p4"]);
    expect(app.state[FILTER_DEFAULT_SETTING]).toBe(false);
    expect(app.state.showSleeping).toBe(true);
    expect(app.state.other).toBe(1);
  });

  it("the page state and the saved file agree after the burst", () => {
    const app = fakeApp(start);
    app.render();
    app.clear();
    app.tick("p2");
    app.render();
    expect(app.disk).toEqual(app.state);
  });

  it("every Clear filters write lands, not only the last", () => {
    const app = fakeApp(start);
    app.render();
    app.clear();
    app.render();
    expect(app.state).toEqual({ ...start, [FILTER_PROJECTS_SETTING]: [], [FILTER_DEFAULT_SETTING]: false, showSleeping: true });
  });

  it("two ticks in a row both count", () => {
    const app = fakeApp({});
    app.render();
    app.tick("p2");
    app.tick("p3");
    app.render();
    expect(filtersFrom(app.state).projects).toEqual(["p1", "p4"]);
  });

  it("the first and the last project behave the same as a middle one", () => {
    for (const [id, want] of [["p1", ["p2", "p3", "p4"]], ["p4", ["p1", "p2", "p3"]]] as const) {
      const app = fakeApp(start);
      app.render();
      app.clear();
      app.tick(id);
      app.render();
      expect(filtersFrom(app.state).projects).toEqual(want);
    }
  });

  it("a render forgets the pending writes", () => {
    const panel = pendingWrites();
    panel.put("a", 1);
    expect(panel.latest({ b: 2 })).toEqual({ a: 1, b: 2 });
    panel.reset();
    expect(panel.latest({ b: 2 })).toEqual({ b: 2 });
  });
});
