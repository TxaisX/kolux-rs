import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import RightSidebar, { clampWidth, readRight, RIGHT_MIN } from "./RightSidebar";

test("VIEW-056: open by default on Explorer; open, tab and width come back as saved", () => {
  expect(readRight({})).toEqual({ open: true, tab: "explorer", width: 300 });
  expect(readRight({ rightSidebarOpen: false, rightSidebarTab: "scm", rightSidebarWidth: 640 })).toEqual({ open: false, tab: "scm", width: 640 });
});

test("VIEW-056: an unknown or old Search tab falls back to Explorer; a width under the minimum is not used", () => {
  expect(readRight({ rightSidebarTab: "search" }).tab).toBe("explorer");
  expect(readRight({ rightSidebarTab: "nope" }).tab).toBe("explorer");
  expect(readRight({ rightSidebarWidth: 40 }).width).toBe(300);
  expect(readRight({ rightSidebarWidth: "wide" }).width).toBe(300);
});

test("VIEW-056: a saved width wider than 500 is honoured; the minimum and the workspace's reserved room are kept", () => {
  expect(clampWidth(640, 1916, 297)).toBe(640);
  expect(clampWidth(100, 1916, 297)).toBe(RIGHT_MIN);
  expect(clampWidth(1400, 1416, 297)).toBe(1416 - 297 - 400);
  expect(clampWidth(500, 700, 297)).toBe(RIGHT_MIN);
});

test("VIEW-073: a saved Checks tab comes back as Checks", () => {
  expect(readRight({ rightSidebarTab: "checks" }).tab).toBe("checks");
});

test("VIEW-057: the tab strip lists Explorer, Source Control and Checks and marks the open one", () => {
  const html = renderToString(createElement(RightSidebar, { tab: "scm", width: 320, onTab: () => {}, onWidth: () => {}, children: "body" }));
  expect(html).toMatch(/aria-label="Right sidebar"/);
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Explorer/);
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Source Control/);
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Checks/);
  expect(html).toContain("width:320px");
  expect(html).toContain('aria-label="Resize the right sidebar"');
});
