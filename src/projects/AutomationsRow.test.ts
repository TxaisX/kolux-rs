// AUTO-023: the Automations row in the sidebar nav, rendered to HTML with no browser.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { CHROME } from "../chrome/chromeItems";
import AutomationsRow from "./AutomationsRow";

const html = (open: boolean) => renderToString(createElement(AutomationsRow, { open, onOpen: () => {}, onHide: () => {} }));

test("AUTO-023: the row opens the Automations page and shows as current while it is up", () => {
  expect(html(false)).toContain("Automations");
  expect(html(false)).toContain('class="row"');
  expect(html(false)).not.toContain('aria-current="page"');
  expect(html(true)).toContain('aria-current="page"');
  expect(html(false)).not.toContain('role="menu"');
});

test("AUTO-023: the Appearance switch names the sidebar row it controls", () => {
  expect(CHROME.find((c) => c.id === "automationsButton")?.label).toBe("Show Automations row in the sidebar");
});
