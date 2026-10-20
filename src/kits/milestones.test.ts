// SKILL-016: kit launches and results tick the first-run milestones; the strip is a tour anchor.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { KITS } from "./catalog";
import KitStrip from "./KitStrip";
import { KIT_RESULTS_TARGET, TOUR_ANCHOR, noteKitLaunch, noteOwnFile, noteResults, openResults, usesOwnFile } from "./milestones";
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

// T-333-b (ONB-013): the own-file mark.
const SAMPLES = "C:\\Users\\me\\AppData\\Roaming\\app\\samples\\spreadsheet";
const sheet = KITS.find((k) => k.id === "spreadsheet")!;
const fileInput = sheet.inputs.find((i) => i.kind === "file")!;
const fileId = fileInput.id;

test("ONB-013: a file the user picked counts as their own; the kit's sample file and unknown samples do not", () => {
  expect(usesOwnFile(sheet, { [fileId]: "D:\\Work\\sales.csv" }, SAMPLES)).toBe(true);
  expect(usesOwnFile(sheet, { [fileId]: `${SAMPLES}\\${fileInput.sample}` }, SAMPLES)).toBe(false);
  expect(usesOwnFile(sheet, { [fileId]: SAMPLES.toUpperCase().replace(/\\/g, "/") + "/x.csv" }, SAMPLES)).toBe(false); // slash style and case are not a difference
  expect(usesOwnFile(sheet, { [fileId]: `${SAMPLES}\\..\\..\\secret.csv` }, SAMPLES)).toBe(true); // climbing out of the samples folder is not inside it
  expect(usesOwnFile(sheet, { [fileId]: "   " }, SAMPLES)).toBe(false);
  expect(usesOwnFile(sheet, {}, SAMPLES)).toBe(false);
  expect(usesOwnFile(sheet, { [fileId]: "D:\\Work\\sales.csv" }, null)).toBe(false); // samples folder not known yet: no guess
});

test("ONB-013: a text-only answer is not a picked file", () => {
  const research = KITS.find((k) => k.id === "research")!;
  expect(usesOwnFile(research, { topic: "D:\\looks\\like\\a\\path.csv" }, SAMPLES)).toBe(false);
});

test("ONB-013: the own-file mark is sent only after a launch that started, on a picked file", async () => {
  const sent: string[] = [];
  const mark = () => (sent.push("own"), Promise.resolve());
  const own = { [fileId]: "D:\\Work\\sales.csv" };
  await noteOwnFile(sheet, own, SAMPLES, Promise.resolve(true), mark);
  expect(sent).toEqual(["own"]);
  await noteOwnFile(sheet, own, SAMPLES, Promise.resolve(false), mark); // nothing started
  await noteOwnFile(sheet, own, SAMPLES, undefined, mark); // the caller did not say
  await noteOwnFile(sheet, own, SAMPLES, Promise.reject(new Error("x")), mark); // a failed start
  await noteOwnFile(sheet, { [fileId]: `${SAMPLES}\\sample.csv` }, SAMPLES, Promise.resolve(true), mark); // the sample
  expect(sent).toEqual(["own"]);
});

test("SKILL-016: the kit results strip carries the anchor a tour step can target", () => {
  const sheet = KITS.find((k) => k.id === "spreadsheet")!;
  const check: RunCheck = { record: { kit: sheet.id, title: sheet.title, started: 1, roles: sheet.roles.map((x) => ({ id: x.id, ai: "claude" })) }, files: {} };
  const noop = () => {};
  const html = renderToString(createElement(KitStrip, { check, seats: [], sent: {}, now: 2, folded: true, onFold: noop, onOpen: noop, onFocusSeat: noop }));
  expect(html).toContain(`data-tour-anchor="${TOUR_ANCHOR}"`);
  expect(KIT_RESULTS_TARGET).toBe('[data-tour-anchor="kit-results"]');
});
