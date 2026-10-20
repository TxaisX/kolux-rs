import { expect, test } from "vitest";
import { inboxOverlay, onClose, onRunning, type Kept } from "./exitedPrompt";
import { inboxItems, type Source } from "./inbox";

const src = (key: number, state: Source["state"], extra: Partial<Source> = {}): Source => ({ key, agent: "claude", title: `Claude ${key}`, branch: "main", cwd: "G:/repo", state, interrupted: false, running: true, changed: 1000, finishedAt: null, ...extra });

test("T-035-b FIX-2: a program that exits with a permission or a question open is remembered, nothing else is", () => {
  expect(onRunning({}, 4, false, "permission")).toEqual({ 4: "permission" });
  expect(onRunning({}, 4, false, "waiting")).toEqual({ 4: "waiting" });
  for (const state of ["blocked", "working", "done", "idle", "queued", "interrupted"] as const) expect(onRunning({}, 4, false, state)).toEqual({});
});

test("T-035-b FIX-2: a second exit call with no hook state left does not lose the remembered prompt, a stop or a finish replaces it", () => {
  const kept: Kept = { 4: "permission", 7: "waiting" };
  expect(onRunning(kept, 4, false, undefined)).toBe(kept);
  expect(onRunning(kept, 4, false, "done")).toEqual({ 7: "waiting" });
  expect(onRunning(kept, 7, false, "blocked")).toEqual({ 4: "permission" });
  expect(kept).toEqual({ 4: "permission", 7: "waiting" });
});

test("T-035-b FIX-2: a pane that starts again forgets its remembered prompt, and only its own", () => {
  const kept: Kept = { 4: "permission", 7: "waiting" };
  expect(onRunning(kept, 4, true, undefined)).toEqual({ 7: "waiting" });
  expect(onRunning(kept, 9, true, undefined)).toBe(kept);
});

test("T-035-b FIX-2: closing panes forgets exactly their remembered prompts", () => {
  const kept: Kept = { 4: "permission", 7: "waiting", 9: "waiting" };
  expect(onClose(kept, [4, 9, 100])).toEqual({ 7: "waiting" });
  expect(onClose(kept, [100])).toBe(kept);
  expect(kept).toEqual({ 4: "permission", 7: "waiting", 9: "waiting" });
});

test("T-035-b FIX-2: the Inbox shows the remembered prompt for an exited pane as needs-you, exited", () => {
  const { sources, kept } = inboxOverlay([src(4, "idle", { running: false })], { 4: "permission" }, {});
  expect(kept).toEqual({ 4: "permission" });
  expect(sources[0].state).toBe("permission");
  expect(inboxItems(sources, 5000)[0]).toMatchObject({ group: "needs", label: "Permission", exited: true });
});

test("T-035-b FIX-2: a pane that runs again, or whose pane is gone, or that has a fresh hook state, drops the remembered prompt", () => {
  const live = inboxOverlay([src(4, "working", { running: true })], { 4: "permission" }, {});
  expect(live.sources[0].state).toBe("working");
  expect(live.kept).toEqual({});
  const gone = inboxOverlay([src(5, "idle", { running: false })], { 4: "permission", 5: "waiting" }, {});
  expect(gone.kept).toEqual({ 5: "waiting" });
  // A late hook event after the exit: the fresh state wins and the old prompt is forgotten for good.
  const late = inboxOverlay([src(4, "working", { running: false })], { 4: "permission" }, { 4: "working" });
  expect(late.sources[0].state).toBe("working");
  expect(late.kept).toEqual({});
});

test("T-035-b FIX-2: with nothing remembered the overlay hands back the same sources and the same map", () => {
  const sources = [src(1, "idle", { running: false })];
  const kept: Kept = {};
  const out = inboxOverlay(sources, kept, {});
  expect(out.sources).toBe(sources);
  expect(out.kept).toBe(kept);
});
