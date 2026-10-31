// STAT-050, DT-C52: the user guide is the app's own description of the Inbox, so its group table has to
// name the groups the Inbox really has, in order. This check failed when the build gained the Stopped
// group and the guide still listed three groups (cycle 3 follow-up).
import { expect, test } from "vitest";
import guide from "../../docs/guide/board-agents-inbox.md?raw";
import { GROUPS } from "./inbox";

const section = () => {
  const from = guide.indexOf("## The Inbox");
  const to = guide.indexOf("## The Tower");
  return from < 0 || to < from ? "" : guide.slice(from, to);
};
const rows = () =>
  section()
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.split("|")[1].trim())
    .filter((h) => h !== "" && h !== "Group" && !/^-+$/.test(h));

test("the guide's Inbox groups are the Inbox's own groups, in order", () => {
  expect(rows()).toEqual(GROUPS.map((g) => g.title));
});

test("the guide says what puts a session in Done today and what puts it in Stopped", () => {
  const s = section();
  expect(s).toContain("Permission, Question or Blocked");
  expect(s).toMatch(/Done today[^\n]*finished[^\n]*still running/i);
  expect(s).toMatch(/Stopped[^\n]*program exited/i);
});
