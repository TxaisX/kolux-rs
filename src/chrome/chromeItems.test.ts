import { expect, test } from "vitest";
import { CHROME, chromeShown, windowSummary } from "./chromeItems";

test("SET-020: Tasks and Automations buttons show and the app name is hidden by default (DT-A6)", () => {
  expect(CHROME.map((c) => c.id)).toEqual(["titleBarAppName", "tasksButton", "automationsButton"]);
  expect(chromeShown({}, "tasksButton")).toBe(true);
  expect(chromeShown({}, "automationsButton")).toBe(true);
  expect(chromeShown({}, "titleBarAppName")).toBe(false);
  expect(chromeShown({ tasksButton: false, titleBarAppName: true }, "tasksButton")).toBe(false);
  expect(chromeShown({ titleBarAppName: true }, "titleBarAppName")).toBe(true);
  expect(chromeShown({ tasksButton: "no" }, "tasksButton")).toBe(true);
});

test("SET-016: the folded Window & Sidebar header sums up what shows", () => {
  expect(windowSummary({})).toBe("Tasks · Automations · Status bar");
  expect(windowSummary({ titleBarAppName: true, automationsButton: false, statusBarVisible: false })).toBe("App name · Tasks · Status bar hidden");
  expect(windowSummary({ tasksButton: false, automationsButton: false, statusBarHidden: ["memory"] })).toBe("Status bar, 3 of 4 items");
});
