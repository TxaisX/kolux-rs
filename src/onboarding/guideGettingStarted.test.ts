// T-612 (T-568): the user guide's first-launch table has to name the wizard's screens as the app has them and
// say what its buttons do now that kits and sample data are gone: "Your work" offers Pick a folder or Continue,
// and "Open a session" with no project yet hands over to Add Project. This check failed while the guide still
// described the "Try with sample data" and "Choose a kit ... Start kit" screens (STATE.md follow-up of 2026-10-30).
import { expect, test } from "vitest";
import guide from "../../docs/guide/getting-started.md?raw";
import { SCREENS } from "./firstRun";

const table = () => guide.slice(guide.indexOf("## First launch"), guide.indexOf("## The Getting Started guide"));
const rows = () =>
  table()
    .split("\n")
    .filter((l) => /^\| \d\./.test(l))
    .map((l) => l.split("|").map((c) => c.trim()));

test("the step table names the wizard's four screens, in order", () => {
  expect(rows().map((r) => r[1])).toEqual(SCREENS.map((s, i) => `${i + 1}. ${s.name}`));
});

test("the step table no longer describes sample data or kits", () => {
  expect(table()).not.toMatch(/sample data/i);
  expect(table()).not.toMatch(/\bkits?\b/i);
  expect(table()).not.toContain("Start kit");
});

test("the step table says Your work offers Pick a folder, and Open a session falls back to Add Project", () => {
  const [, , work, session] = rows();
  expect(work[2]).toContain("Pick a folder");
  expect(work[3]).toBe("Continue");
  expect(session[2]).toContain("Add Project");
  expect(session[3]).toBe("Open a session");
});

test("the Tips section says Escape closes a tip from wherever the keyboard is", () => {
  const tips = guide.slice(guide.indexOf("### Tips"), guide.indexOf("### Tours"));
  expect(tips).toMatch(/Escape[^\n]*closes[^\n]*tip/i);
});
