// SKILL-016: kit launches and results tick the first-run milestones; the strip is a tour anchor.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { KITS } from "./catalog";
import KitStrip from "./KitStrip";
import { KIT_RESULTS_TARGET, TOUR_ANCHOR, noteKitLaunch, noteResults, openResults } from "./milestones";
import type { Milestone } from "../onboarding/firstRun";
import type { RunCheck } from "./run";

const recorder = () => {
  const got: Milestone[] = [];
  return { got, record: (m: Milestone) => (got.push(m), Promise.resolve()) };
};

test("SKILL-016: a launch where at least one AI started records the first-kit milestone; none started records nothing", async () => {
  const r = recorder();
  await noteKitLaunch(0, r.record);
  expect(r.got).toEqual([]);
  await noteKitLaunch(1, r.record);
  await noteKitLaunch(3, r.record);
  expect(r.got).toEqual(["kitLaunched", "kitLaunched"]); // onboarding keeps only the first time
});

test("SKILL-016: Open results opens first and then records the first-results milestone; Collect records it too", async () => {
  const r = recorder();
  const order: string[] = [];
  openResults(() => order.push("open"), (m) => (order.push(m), Promise.resolve()))();
  expect(order).toEqual(["open", "resultsOpened"]);
  await noteResults(r.record);
  expect(r.got).toEqual(["resultsOpened"]);
});

test("SKILL-016: the kit results strip carries the anchor a tour step can target", () => {
  const sheet = KITS.find((k) => k.id === "spreadsheet")!;
  const check: RunCheck = { record: { kit: sheet.id, title: sheet.title, started: 1, roles: sheet.roles.map((x) => ({ id: x.id, ai: "claude" })) }, files: {} };
  const noop = () => {};
  const html = renderToString(createElement(KitStrip, { check, seats: [], sent: {}, now: 2, folded: true, onFold: noop, onOpen: noop, onFocusSeat: noop }));
  expect(html).toContain(`data-tour-anchor="${TOUR_ANCHOR}"`);
  expect(KIT_RESULTS_TARGET).toBe('[data-tour-anchor="kit-results"]');
});
