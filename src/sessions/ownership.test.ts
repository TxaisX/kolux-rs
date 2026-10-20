import { expect, test } from "vitest";
import { claim, forkFields, resumeId, uniqueOwners } from "./ownership";

const pane = (key: number, session?: string) => (session === undefined ? { key } : { key, session });

test("ACCT-063: a pane that reports a session owns it and the pane that held it lets go", () => {
  const before = [pane(1, "s-1"), pane(2, "s-2"), pane(3)];
  const after = claim(before, 3, "s-1");
  expect(after).toEqual([pane(1), pane(2, "s-2"), pane(3, "s-1")]);
  expect(before[0].session).toBe("s-1"); // the old array is untouched
});

test("ACCT-063: a report that changes nothing returns the same panes; an unknown pane or an empty id claims nothing", () => {
  const panes = [pane(1, "s-1"), pane(2)];
  expect(claim(panes, 1, "s-1")).toBe(panes);
  expect(claim(panes, 9, "s-1")).toBe(panes);
  expect(claim(panes, 2, "")).toBe(panes);
});

test("ACCT-063: a pane's new session (a /clear or a resume) replaces its old one and nobody else changes", () => {
  const panes = [pane(1, "s-1"), pane(2, "s-2")];
  expect(claim(panes, 1, "s-3")).toEqual([pane(1, "s-3"), pane(2, "s-2")]);
});

test("ACCT-063: restoring several tabs with one session leaves it with the newest tab only", () => {
  const panes = [pane(2, "s-1"), pane(5, "s-1"), pane(4, "s-2"), pane(6)];
  expect(uniqueOwners(panes)).toEqual([pane(2), pane(5, "s-1"), pane(4, "s-2"), pane(6)]);
  const clean = [pane(1, "a"), pane(2, "b")];
  expect(uniqueOwners(clean)).toBe(clean);
});

test("ACCT-063: a fork is recorded as a fork of its source and a restart never resumes the source for it", () => {
  expect(forkFields({ session: "s-1" })).toEqual({ forkOf: "s-1" });
  expect(forkFields({})).toEqual({});
  expect(resumeId({ forkOf: "s-1" })).toBeNull();
  expect(resumeId({ forkOf: "s-1", session: "s-1" })).toBeNull();
  expect(resumeId({ forkOf: "s-1", session: "s-2" })).toBe("s-2");
  expect(resumeId({ session: "s-1" })).toBe("s-1");
  expect(resumeId({})).toBeNull();
});
