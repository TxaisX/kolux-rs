// AUTO-011 box 3: type in a run's tab, then the agent exits -> the tab stays open. The deciding functions
// are the real runTab.ts ones; the two App.tsx listeners around them are mirrored below.
// MIRROR App.tsx keydown listener (typedInRunTab -> touchRunTab) and terminal-exit listener (runTabEnded -> dropPane).
import { expect, test } from "vitest";
import { openRunTab, paneOfTerminal, runTabEnded, touchRunTab, typedInRunTab, type RunTabs } from "../runTab";

/** The window's two listeners, as App.tsx wires them; `dropped` collects the panes closed. */
function window_(ptys: Record<number, number>, focused: number) {
  let tabs: RunTabs = {};
  const dropped: number[] = [];
  return {
    runStarted: (key: number, runId: string) => void (tabs = openRunTab(tabs, key, runId)),
    keydown: (insideFocusedPane: boolean) => void (typedInRunTab(tabs, focused, insideFocusedPane) && (tabs = touchRunTab(tabs, focused))),
    exit: (terminal: number, pinned = false) => {
      const key = paneOfTerminal(ptys, terminal);
      if (key === null) return;
      const ended = runTabEnded(tabs, key, pinned);
      tabs = ended.tabs;
      if (ended.verdict === "close") dropped.push(key);
    },
    dropped,
  };
}

test("box 3: typing in the run's tab, then the agent exiting, leaves the tab open", () => {
  const w = window_({ 7: 52 }, 7);
  w.runStarted(7, "run-1");
  w.keydown(true); // a key inside the focused run tab
  w.exit(52);
  expect(w.dropped).toEqual([]);
});

test("box 3 control: an untouched run tab shuts once when its agent exits; keys elsewhere do not count as typing in it", () => {
  const w = window_({ 7: 52 }, 7);
  w.runStarted(7, "run-1");
  w.keydown(false); // typing in another pane while this tab is only focused by the app
  w.exit(52);
  w.exit(52); // a second exit event closes nothing more
  expect(w.dropped).toEqual([7]);
});
