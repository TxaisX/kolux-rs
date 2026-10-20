import { expect, test } from "vitest";
import { forgetRunTab, openRunTab, paneOfTerminal, runPaneKey, runTabEnded, touchRunTab, typedInRunTab, type RunTabs } from "./runTab";

const opened = (): RunTabs => openRunTab({}, 7, "run-1");

test("T-085-g an untouched run tab closes when its agent exits, once", () => {
  const first = runTabEnded(opened(), 7, false);
  expect(first.verdict).toBe("close");
  // the tab is forgotten with the answer: a second exit event for the same pane closes nothing
  expect(runTabEnded(first.tabs, 7, false).verdict).toBe("ignore");
});

test("T-085-g a tab the user clicked or typed in stays open when the agent exits", () => {
  const touched = touchRunTab(opened(), 7);
  expect(touched[7].touched).toBe(true);
  const r = runTabEnded(touched, 7, false);
  expect(r.verdict).toBe("keep");
  expect(r.tabs[7]).toBeUndefined();
  // touching is idempotent and returns the same object, so state does not churn
  expect(touchRunTab(touched, 7)).toBe(touched);
});

test("T-085-g a pinned run tab stays open", () => {
  expect(runTabEnded(opened(), 7, true).verdict).toBe("keep");
});

test("T-085-g a tab no run opened is never followed or closed", () => {
  const tabs = opened();
  expect(runTabEnded(tabs, 9, false)).toEqual({ verdict: "ignore", tabs });
  expect(touchRunTab(tabs, 9)).toBe(tabs);
  expect(forgetRunTab(tabs, 9)).toBe(tabs);
  expect(runTabEnded({}, 7, false).verdict).toBe("ignore");
});

test("T-085-g touching one run tab leaves another run's tab to close", () => {
  const tabs = touchRunTab(openRunTab(opened(), 8, "run-2"), 8);
  expect(runTabEnded(tabs, 7, false).verdict).toBe("close");
  expect(runTabEnded(tabs, 8, false).verdict).toBe("keep");
});

test("T-085-g a tab closed or replaced by other means is no longer followed", () => {
  expect(runTabEnded(forgetRunTab(opened(), 7), 7, false).verdict).toBe("ignore");
});

test("T-085-g the exiting terminal is matched to its pane, and an unknown terminal to none", () => {
  const ptys = { 3: 41, 7: 52 };
  expect(paneOfTerminal(ptys, 52)).toBe(7);
  expect(paneOfTerminal(ptys, 99)).toBeNull();
});

test("T-085-g only keys inside the focused pane, when that pane is a followed tab, count as typing", () => {
  const tabs = opened();
  expect(typedInRunTab(tabs, 7, true)).toBe(true);
  expect(typedInRunTab(tabs, 7, false)).toBe(false);
  expect(typedInRunTab(tabs, 3, true)).toBe(false);
});

test("T-031-b View run finds a run's pane again after a restart through the run's own terminal", () => {
  // Before the restart the window remembered the pane itself.
  expect(runPaneKey({ "run-1": 7 }, { id: "run-1", terminal: 3 }, { 7: 3 })).toBe(7);
  // After a restart the window remembers nothing, but the reconnected run row names its terminal.
  expect(runPaneKey({}, { id: "run-1", terminal: 3 }, { 7: 3, 8: 4 })).toBe(7);
  // A run with no terminal (never dispatched, or tidied after a restart and not reconnected) has no pane.
  expect(runPaneKey({}, { id: "run-1" }, { 7: 3 })).toBeUndefined();
  // A terminal no open pane holds any more is not a pane.
  expect(runPaneKey({}, { id: "run-1", terminal: 9 }, { 7: 3 })).toBeUndefined();
  // The window's own memory wins over the row, so a pane the run moved to is still the one opened.
  expect(runPaneKey({ "run-1": 8 }, { id: "run-1", terminal: 3 }, { 7: 3, 8: 4 })).toBe(8);
});
