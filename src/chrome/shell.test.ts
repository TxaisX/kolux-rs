// The window's fixed chrome, rendered to HTML with no browser: top bar (switcher, search hint,
// usage pill, the window's own minimize / maximize / close), layout strip and status bar. If a
// later change drops one of these blocks, this fails before anyone opens the app.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import TopBar from "./TopBar";
import type { TopBarProps } from "./TopBar";
import LayoutStrip from "./LayoutStrip";
import StatusBar from "./StatusBar";
import { KeymapContext, type KeymapState } from "../keys/KeymapContext";
import { resolve } from "../keys/keymap";
import { Mark } from "./icons";

test("the top bar carries the screen switcher, search hint, usage pill and window controls", () => {
  const html = renderToString(createElement(TopBar, { screen: "terminals", onScreen: () => {}, sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} }));
  expect(html).toContain('class="topbar"');
  expect(html).toContain("data-tauri-drag-region");
  for (const label of ["Agents", "Board", "Terminals"]) expect(html).toContain(`>${label}</button>`);
  expect(html).toMatch(/aria-pressed="true"[^>]*>Terminals<\/button>/);
  expect(html).toContain('class="searchbox"');
  expect(html).toContain("Ctrl");
  // USAGE-008: no usage data yet → the pill is not drawn, and it is not a button (nothing to click).
  expect(html).toContain('class="usage" hidden=""');
  expect(html).not.toContain("Claude");
  expect(html).not.toContain('<button class="usage"');
  for (const control of ["Minimize", "Maximize", "Close"]) expect(html).toContain(`title="${control}"`);
});

test("the search box chips follow the keybindings file", () => {
  const topbar = createElement(TopBar, { screen: "terminals", onScreen: () => {}, sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} });
  const plain = renderToString(topbar);
  expect(plain).toMatch(/kbd">Ctrl<.*kbd">Shift<.*kbd">J</);
  const custom: KeymapState = { ...resolve({ version: 1, platforms: { win32: { "worktree.palette": "Mod+Alt+P" } } }, "win32"), path: null, reload: () => {}, save: async () => {} };
  const html = renderToString(createElement(KeymapContext.Provider, { value: custom }, topbar));
  expect(html).toMatch(/kbd">Ctrl<.*kbd">Alt<.*kbd">P</);
  expect(html).not.toContain('kbd">J<');
  const unbound: KeymapState = { ...resolve({ keybindings: { "worktree.palette": null } }, "win32"), path: null, reload: () => {}, save: async () => {} };
  expect(renderToString(createElement(KeymapContext.Provider, { value: unbound }, topbar))).toContain("Unassigned");
});

test("the app mark is the six-spoke glyph on a 24-unit grid in the text colour", () => {
  const html = renderToString(createElement(Mark));
  expect(html).toContain('viewBox="0 0 24 24"');
  expect(html).toContain('fill="currentColor"');
  expect((html.match(/<use /g) ?? []).length).toBe(5);
  expect(html).toContain("<circle");
});

test("the layout strip offers 1, 2, 4 and 6 panes with the current one pressed", () => {
  const html = renderToString(createElement(LayoutStrip, { count: 1, onLayout: () => {} }));
  expect(html).toContain('class="strip"');
  for (const n of [1, 2, 4, 6]) expect(html).toContain(`>${n}</button>`);
  expect(html).toMatch(/aria-pressed="true"[^>]*>1<\/button>/);
  expect(html).not.toMatch(/aria-pressed="true"[^>]*>4<\/button>/);
  expect(html).not.toContain("New tab");
});

test("TERM-040: the strip offers a New tab menu when the window wires one", () => {
  const html = renderToString(createElement(LayoutStrip, { count: 1, onLayout: () => {}, agents: [], onNewTab: () => {} }));
  expect(html).toMatch(/aria-haspopup="menu"[^>]*>.*New tab/);
});

test("BROW-001: the New tab menu offers a browser tab with its chord", () => {
  const html = renderToString(createElement(LayoutStrip, { count: 1, onLayout: () => {}, agents: [], onNewTab: () => {}, open: true }));
  expect(html).toMatch(/Terminal.*Browser/);
  expect(html).toMatch(/Browser[\s\S]*?<span class="kbd">B<\/span>/);
});

test("the status bar shows hooks, memory, terminals and agents on the right", () => {
  const html = renderToString(createElement(StatusBar, { terminals: 3, agents: 1 }));
  expect(html).toContain('class="statusbar"');
  expect(html).toContain("On");
  expect(html).toContain("MB");
  expect(html).toMatch(/Terminals running[^>]*>.*3/);
  expect(html).toMatch(/Agents running[^>]*>.*1/);
});

test("VIEW-011: the Automations button shows only when it is turned on, pressed while the page is open", () => {
  const base: TopBarProps = { screen: "terminals", onScreen: () => {}, sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} };
  expect(renderToString(createElement(TopBar, base))).not.toContain('title="Automations"');
  const on = renderToString(createElement(TopBar, { ...base, automations: { open: true, onToggle: () => {} } }));
  expect(on).toContain('title="Automations"');
  expect(on).toMatch(/aria-pressed="true"[^>]*title="Automations"|title="Automations"[^>]*aria-pressed="true"/);
});
