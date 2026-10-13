import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readAppearance } from "../theme";
import { AppearanceView, fontSaver } from "./AppearancePage";
import { DRAFT_PAUSE_MS, Draft } from "./useSettings";

test("SET-016: Interface, Terminal and Window & Sidebar, all open at first; fonts sit in Interface", () => {
  const html = renderToString(createElement(AppearanceView, { look: readAppearance({}), onChange: () => {}, windowPart: createElement("p", null, "status switch"), windowSummary: "Status bar shown" }));
  const folds = [...html.matchAll(/<details class="look-fold" data-fold="(\w+)" open="">/g)].map((m) => m[1]);
  expect(folds).toEqual(["interface", "terminal", "window"]);
  expect(html).toContain("Window &amp; Sidebar");
  expect(html).toContain("status switch");
  expect(html.indexOf("App font")).toBeLessThan(html.indexOf('data-fold="terminal"'));
  expect(html).toContain("Editor font");
});

test("SET-023: the Panes card in Terminal holds divider width, a colour per mode and the dim", () => {
  const html = renderToString(createElement(AppearanceView, { look: readAppearance({ paneDividerDark: "#aa3300", paneDim: 70 }), onChange: () => {} }));
  const panes = html.slice(html.indexOf('data-section="panes"'), html.indexOf('data-fold="window"'));
  expect(panes).toContain("Divider width");
  expect(panes).toContain('aria-label="Divider colour, dark mode" value="#aa3300"');
  expect(panes).toContain("Divider colour, light mode");
  expect(panes.match(/>Clear</g)?.length, "only the set colour can be cleared").toBe(1);
  expect(panes).toMatch(/Panes not in focus.*value="70"/);
});

test("SET-036: a font field saves after a pause, trimmed, and never in the middle of a composition", async () => {
  vi.useFakeTimers();
  try {
    const picked: string[] = [];
    const d = new Draft("", fontSaver((f) => picked.push(f)));
    d.type("  Fira Code ");
    expect(picked, "nothing before the pause").toEqual([]);
    await vi.advanceTimersByTimeAsync(DRAFT_PAUSE_MS);
    expect(picked).toEqual(["Fira Code"]);
    d.compose(true);
    d.type("游ゴシック");
    await vi.advanceTimersByTimeAsync(DRAFT_PAUSE_MS * 3);
    expect(await d.flush(), "leaving the field mid-composition keeps the text unsaved").toBe(false);
    expect(picked).toEqual(["Fira Code"]);
    d.compose(false);
    await vi.advanceTimersByTimeAsync(DRAFT_PAUSE_MS);
    expect(picked).toEqual(["Fira Code", "游ゴシック"]);
    d.type("");
    expect(await d.flush(), "an emptied field saves the default straight away on leaving").toBe(true);
    expect(picked).toEqual(["Fira Code", "游ゴシック", ""]);
  } finally {
    vi.useRealTimers();
  }
});
