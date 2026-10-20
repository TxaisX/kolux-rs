import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readAppearance } from "../theme";
import { AppearanceView } from "../settings/AppearancePage";
import { CardDensityBody, SidebarLookBody } from "./SidebarSettings";

const html = (el: ReturnType<typeof createElement>) => renderToString(el).replace(/<!-- -->/g, "");

test("SET-021: the sidebar look offers Standard, Match terminal and Tinted; the colour and strength show only for Tinted", () => {
  const std = html(createElement(SidebarLookBody, { look: readAppearance({}), onChange: () => {} }));
  expect(std).toMatch(/aria-checked="true">Standard</);
  for (const w of ["Match terminal", "Tinted"]) expect(std).toContain(w);
  expect(std).not.toContain("Sidebar tint colour");
  const tinted = html(createElement(SidebarLookBody, { look: readAppearance({ sidebarLook: "tinted", sidebarTint: "#cc2200", sidebarTintStrength: 15 }), onChange: () => {} }));
  expect(tinted).toMatch(/aria-checked="true">Tinted</);
  expect(tinted).toContain('aria-label="Sidebar tint colour" value="#cc2200"');
  expect(tinted).toMatch(/aria-label="Sidebar tint strength"[^>]*value="15"/);
  expect(tinted).toContain("15 %");
});

test("SET-021: the card layout reads Default, Compact, Detailed; Custom shows only for a set the user chose by hand", () => {
  const card = (s: Record<string, unknown>) => html(createElement(CardDensityBody, { settings: s, save: () => {} }));
  expect(card({})).toMatch(/aria-checked="true">Default</);
  expect(card({ workspaceCardDensity: "compact" })).toMatch(/aria-checked="true">Compact</);
  expect(card({ workspaceCardDensity: "compact" })).not.toContain(">Custom<");
  const custom = card({ workspaceCardDetails: ["pr"] });
  expect(custom).toMatch(/aria-checked="true">Custom</);
});

test("SET-021: pinned workspaces in their groups is a switch, off by default", () => {
  const sw = (s: Record<string, unknown>) => html(createElement(CardDensityBody, { settings: s, save: () => {} })).match(/<input[^>]*Pinned workspaces also in their groups[^>]*>/)?.[0] ?? "";
  expect(sw({})).not.toContain("checked");
  expect(sw({ pinnedCopies: true })).toContain("checked");
});

test("SET-021: Window & Sidebar holds the sidebar look above the other window switches", () => {
  const page = html(createElement(AppearanceView, { look: readAppearance({}), onChange: () => {}, windowPart: createElement("p", null, "status switch") }));
  const win = page.slice(page.indexOf('data-fold="window"'));
  expect(win.indexOf('data-section="sidebar-look"')).toBeGreaterThan(0);
  expect(win.indexOf('data-section="sidebar-look"')).toBeLessThan(win.indexOf("status switch"));
});
