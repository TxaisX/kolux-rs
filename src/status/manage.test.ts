import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { cleanupCandidates, ManageSessions, sessionLabel, type InventoryTab } from "./manage";
import { groupSessions, type SessionUsage } from "./resources";

const s = (id: number): SessionUsage => ({ id, pid: 100 + id, dir: "C:/w/a", bytes: 1, cpu: 0, processes: 1, committed: null, unreadable: 0 });
const tab = (id: number, agent: string | null): InventoryTab => ({ handle: `term-${id}`, agent });

test("T-153-e: Manage Sessions offers only shells no pane shows", () => {
  const sessions = [s(1), s(2), s(3)];
  const tabs = [tab(1, null), tab(2, null), tab(3, null)];
  const got = cleanupCandidates(sessions, tabs, { 1: "pwsh" }, true);
  expect(got.map((r) => r.id)).toEqual([2, 3]);
  expect(cleanupCandidates(sessions, tabs, { 1: "a", 2: "b", 3: "c" }, true), "every session in a pane: nothing to clean").toEqual([]);
});

test("T-153-e: an agent-owned session is never offered, even with no pane", () => {
  const sessions = [s(1), s(2), s(3)];
  const tabs = [tab(1, "claude"), tab(2, null), tab(3, "codex")];
  expect(cleanupCandidates(sessions, tabs, {}, true).map((r) => r.id)).toEqual([2]);
});

test("T-153-e: a session the inventory does not list (or a failed inventory read) is not offered", () => {
  expect(cleanupCandidates([s(1), s(2)], [tab(1, null)], {}, true).map((r) => r.id)).toEqual([1]);
  expect(cleanupCandidates([s(1), s(2)], null, {}, true)).toEqual([]);
});

test("T-153-e: until the window has loaded its workspaces nothing is offered and nothing reads as attached or loose", () => {
  expect(cleanupCandidates([s(1), s(2)], [tab(1, null), tab(2, null)], {}, false)).toEqual([]);
  expect(sessionLabel(4, { 4: "pwsh" }, false)).toEqual({ name: "Session 4", shown: false });
  expect(sessionLabel(4, {}, false).name).not.toContain("not in a pane");
  expect(sessionLabel(4, { 4: "pwsh" }, true)).toEqual({ name: "pwsh", shown: true });
  expect(sessionLabel(5, {}, true)).toEqual({ name: "Session 5 (not in a pane)", shown: false });
});

test("T-153-e: the Manage Sessions section says what it will end, waits while loading, and asks with Keep focused", () => {
  const two = cleanupCandidates([s(2), s(3)], [tab(2, null), tab(3, null)], {}, true);
  const idle = renderToString(ManageSessions({ loaded: true, candidates: two, asking: false, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(idle).toContain("2 sessions no pane shows");
  expect(idle).toContain("End 2");
  const ask = renderToString(ManageSessions({ loaded: true, candidates: two, asking: true, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(ask).toContain("alertdialog");
  expect(ask, "Keep holds focus, so a stray Enter ends nothing (VIEW-116)").toMatch(/<button[^>]*data-focus="keep"[^>]*>Keep<\/button>/);
  expect(ask).toContain("Agent sessions are left alone");
  const none = renderToString(ManageSessions({ loaded: true, candidates: [], asking: false, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(none).toContain("Every session is in a pane");
  expect(none).not.toContain("End ");
  const loading = renderToString(ManageSessions({ loaded: false, candidates: [], asking: false, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(loading).toContain("still loading");
  expect(loading).not.toContain("<button");
});

test("T-153-e: the Resource Manager's rows claim no pane while the window is loading", () => {
  const rows = groupSessions([s(1), s(2)], { 1: "pwsh" }, ["C:/w/a"], false).flatMap((g) => g.rows);
  expect(rows.map((r) => [r.name, r.shown])).toEqual([["Session 1", false], ["Session 2", false]]);
  const after = groupSessions([s(1), s(2)], { 1: "pwsh" }, ["C:/w/a"]).flatMap((g) => g.rows);
  expect(after.map((r) => [r.name, r.shown])).toEqual([["pwsh", true], ["Session 2 (not in a pane)", false]]);
});
