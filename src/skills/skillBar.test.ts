// SKILL-025 / SKILL-027 / VIEW-100: the freshness pill and the status bar item, as pure rules.
import { expect, test } from "vitest";
import { FADE_MS, IDLE, barItem, barReduce, failureOf, fadedAway, nextChange, pillFor, settle, type BarRun } from "./skillBar";
import type { Checked, CopyRow, UpdateRow, UpdateStatus } from "./updateNotice";

const st = (over: Partial<UpdateStatus>): UpdateStatus => ({ state: "done", names: ["a", "b"], command: "", log: "", code: 0, stopped: false, error: null, results: [], ...over });
const running = st({ state: "running", code: null });
const good = (name: string) => ({ name, ok: true, reason: null });
const bad = (name: string) => ({ name, ok: false, reason: "The copy is still out of date" });
const feed = (run: BarRun, status: UpdateStatus, now: number) => barReduce(run, { type: "status", status, now });

test("SKILL-027: idle shows nothing; a running update shows updating with its count", () => {
  expect(barItem(IDLE, 0)).toBeNull();
  const one = feed(IDLE, st({ state: "running", names: ["a"] }), 0);
  expect(barItem(one, 0)).toMatchObject({ tone: "info", text: "Updating 1 skill" });
  const two = feed(IDLE, running, 0);
  expect(barItem(two, 0)).toMatchObject({ tone: "info", text: "Updating 2 skills" });
  expect(barItem(feed(two, st({ state: "stopping", names: ["a", "b"] }), 5), 5)).toMatchObject({ text: "Stopping the skill update" });
});

test("SKILL-027: a success shows the green check and clears itself after about 4 seconds", () => {
  const done = feed(feed(IDLE, running, 0), st({ results: [good("a"), good("b")] }), 1000);
  expect(barItem(done, 1000)).toMatchObject({ tone: "ok", text: "Updated 2 skills" });
  expect(barItem(done, 1000 + FADE_MS - 1)).not.toBeNull();
  expect(barItem(done, 1000 + FADE_MS)).toBeNull();
  expect(nextChange(done, 1000)).toBe(FADE_MS);
  expect(nextChange(done, 1000 + FADE_MS - 50)).toBe(50);
  expect(settle(done, 1000 + FADE_MS)).toEqual(IDLE);
  expect(settle(done, 1000 + FADE_MS - 1)).toBe(done);
});

test("SKILL-027: a repeat of the same finished report does not restart the countdown", () => {
  const done = feed(feed(IDLE, running, 0), st({ results: [good("a")] }), 1000);
  expect(feed(done, st({ results: [good("a")] }), 3000)).toBe(done);
  expect(fadedAway(feed(done, st({ results: [good("a")] }), 3000), 1000 + FADE_MS)).toBe(true);
});

test("SKILL-027: a success is not cleared while the user is reading it in the dialog, then counts 4 seconds after it closes", () => {
  let run = feed(IDLE, running, 0);
  run = barReduce(run, { type: "reading", open: true, now: 100 });
  run = feed(run, st({ results: [good("a"), good("b")] }), 1000);
  expect(run.since).toBeNull();
  expect(barItem(run, 60_000)).toMatchObject({ tone: "ok" });
  expect(nextChange(run, 60_000)).toBeNull();
  run = barReduce(run, { type: "reading", open: false, now: 60_000 });
  expect(barItem(run, 60_000 + FADE_MS - 1)).not.toBeNull();
  expect(barItem(run, 60_000 + FADE_MS)).toBeNull();
});

test("SKILL-027: a success shown, then the dialog opened, holds the check; closing starts the 4 seconds again", () => {
  let run = feed(feed(IDLE, running, 0), st({ results: [good("a")] }), 1000);
  run = barReduce(run, { type: "reading", open: true, now: 2000 });
  expect(nextChange(run, 9000)).toBeNull();
  run = barReduce(run, { type: "reading", open: false, now: 9000 });
  expect(nextChange(run, 9000)).toBe(FADE_MS);
});

test("SKILL-027 / VIEW-100: a failure stays, however long, until it is clicked", () => {
  const failed = feed(feed(IDLE, running, 0), st({ results: [good("a"), bad("b")] }), 1000);
  expect(barItem(failed, 1000)).toMatchObject({ tone: "bad", text: "Skill update failed" });
  expect(barItem(failed, 10 * 60_000)).toMatchObject({ tone: "bad" });
  expect(nextChange(failed, 5000)).toBeNull();
  expect(settle(failed, 10 * 60_000)).toBe(failed);
  expect(barItem(failed, 0)!.title).toContain("1 of 2 skills are still out of date.");
  expect(barReduce(failed, { type: "click" })).toEqual(IDLE);
});

test("SKILL-027: an installer that could not start, or a stopped run, is a failure too", () => {
  expect(failureOf(st({ error: "Node.js was not found", results: [bad("a")] }))).toBe("Node.js was not found");
  expect(failureOf(st({ stopped: true, code: null, results: [good("a")] }))).toBe("The update was stopped.");
  expect(failureOf(st({ results: [bad("a"), bad("b")] }))).toBe("The update did not change anything.");
  expect(failureOf(st({ results: [good("a")] }))).toBeNull();
  expect(barItem(feed(IDLE, st({ error: "Node.js was not found", results: [bad("a")] }), 0), 0)).toMatchObject({ tone: "bad" });
});

test("SKILL-027: clicking a success only reopens the dialog (the check is not acknowledged), an idle report after a failure keeps the failure", () => {
  const done = feed(feed(IDLE, running, 0), st({ results: [good("a")] }), 0);
  expect(barReduce(done, { type: "click" })).toBe(done);
  const failed = feed(done, st({ results: [bad("a")] }), 1);
  expect(feed(failed, st({ state: "idle", names: [] }), 2)).toBe(failed);
  expect(feed(feed(IDLE, running, 0), st({ state: "idle", names: [] }), 1)).toEqual(IDLE);
});

// ---- the pill ------------------------------------------------------------------------------

const copy = (chips: string[], eligible = false): CopyRow => ({ path: "p", source: "home", chips, eligible, reason: null });
const row = (name: string, state: UpdateRow["state"], copies: CopyRow[]): UpdateRow => ({ name, state, reason: null, reinstall: null, copies });
const checked = (rows: UpdateRow[]): Checked => ({ report: { rows, available: rows.filter((r) => r.state === "available").length, revisions: [], notice: [] }, dismissed: [] });

test("SKILL-025: a stale skill offers an update, a current one is up to date", () => {
  const c = checked([row("orchestration", "available", [copy([], true)]), row("koluxward", "current", [copy(["current"])])]);
  expect(pillFor("orchestration", "ready", c)).toMatchObject({ kind: "update", text: "Update available" });
  expect(pillFor("koluxward", "ready", c)).toMatchObject({ kind: "current", text: "Up to date" });
});

test("SKILL-025: a copy changed locally (or unrecorded) shows review, not update", () => {
  const c = checked([row("a", "skipped", [copy(["unrecognised"])]), row("b", "skipped", [copy(["read only"])])]);
  expect(pillFor("a", "ready", c)).toMatchObject({ kind: "review", text: "Review" });
  expect(pillFor("b", "ready", c).kind).toBe("review");
});

test("SKILL-025: installed before the inventory has loaded, checking, and check failed", () => {
  const c = checked([row("a", "available", [copy([], true)])]);
  expect(pillFor("a", "idle", null).kind).toBe("installed");
  expect(pillFor("a", "ready", null).kind).toBe("installed");
  expect(pillFor("a", "checking", null)).toMatchObject({ kind: "checking", text: "Checking..." });
  expect(pillFor("a", "failed", null)).toMatchObject({ kind: "failed", text: "Check failed", tone: "bad" });
  expect(pillFor("a", "failed", c).kind).toBe("failed");
  expect(pillFor("not-installed-outside", "ready", c).kind).toBe("installed");
});
