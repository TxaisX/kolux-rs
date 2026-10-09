// The window's fixed chrome, rendered to HTML with no browser: top bar (switcher, search hint,
// usage pill, the window's own minimize / maximize / close), layout strip and status bar. If a
// later change drops one of these blocks, this fails before anyone opens the app.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import TopBar from "./TopBar";
import LayoutStrip from "./LayoutStrip";
import StatusBar from "./StatusBar";

test("the top bar carries the screen switcher, search hint, usage pill and window controls", () => {
  const html = renderToString(createElement(TopBar, { screen: "terminals", onScreen: () => {}, sidebarOpen: true, onToggleSidebar: () => {} }));
  expect(html).toContain('class="topbar"');
  expect(html).toContain("data-tauri-drag-region");
  for (const label of ["Agents", "Board", "Terminals"]) expect(html).toContain(`>${label}</button>`);
  expect(html).toMatch(/aria-pressed="true"[^>]*>Terminals<\/button>/);
  expect(html).toContain('class="searchbox"');
  expect(html).toContain("Ctrl");
  expect(html).toContain('class="usage"');
  for (const control of ["Minimize", "Maximize", "Close"]) expect(html).toContain(`title="${control}"`);
});

test("the layout strip offers 1, 2, 4 and 6 panes with the current one pressed", () => {
  const html = renderToString(createElement(LayoutStrip, { layout: 1, onLayout: () => {} }));
  expect(html).toContain('class="strip"');
  for (const n of [1, 2, 4, 6]) expect(html).toContain(`>${n}</button>`);
  expect(html).toMatch(/aria-pressed="true"[^>]*>1<\/button>/);
  expect(html).not.toMatch(/aria-pressed="true"[^>]*>4<\/button>/);
});

test("the status bar shows hooks, memory, terminals and agents on the right", () => {
  const html = renderToString(createElement(StatusBar, { terminals: 3, agents: 1 }));
  expect(html).toContain('class="statusbar"');
  expect(html).toContain("On");
  expect(html).toContain("MB");
  expect(html).toMatch(/Terminals running[^>]*>.*3/);
  expect(html).toMatch(/Agents running[^>]*>.*1/);
});
