import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import TowerView from "./TowerView";
import { towerRows, type Seat } from "./tower";

const seat = (key: number): Seat => ({ key, agent: "claude", title: `pane ${key}`, branch: null, cwd: null, account: null, chip: null, meter: null, since: 0 });
const view = (detached?: boolean) => renderToString(createElement(TowerView, { rows: towerRows([seat(1), seat(2)]), usage: [], now: 0, onOpen: () => {}, detached }));

test("T-546-c (council AFTER 2): the listbox is the list of rows, not the whole tower; each lane is a group", () => {
  const html = view();
  expect(html).toMatch(/<div class="list"[^>]*role="listbox"/);
  expect(html).not.toMatch(/<div class="tower"[^>]*role="listbox"/);
  expect(html.match(/role="listbox"/g)?.length).toBe(1);
  expect(html).toMatch(/<section role="group" aria-label="[^"]+"/);
  // the summary and usage cards sit outside the listbox
  expect(html.indexOf("Tower summary")).toBeLessThan(html.indexOf('role="listbox"'));
});

test("T-546-c: the main window's Tower offers its own window; the Tower window itself does not", () => {
  expect(view()).toContain("Own window");
  const detached = view(true);
  expect(detached).not.toContain("Own window");
  expect(detached).toContain('class="tower detached"');
  expect(detached).toContain("Refresh");
});
