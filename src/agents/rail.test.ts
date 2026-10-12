// The Agents screen's rail (VIEW-015, VIEW-021) and the Board's card list (VIEW-024), pure so they run without a browser.
import { expect, test } from "vitest";
import { cardPanes, pickSession, railGroups, sessionLabel } from "./rail";

const saved = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];
const ai = (key: number, agentId: string | undefined, extra: Record<string, unknown> = {}) => ({ key, agentId, program: "x", cwd: "C:/w/app", ...extra });
const shell = (key: number) => ({ key, program: null, cwd: "C:/w/app" });

test("VIEW-015: sessions group under their saved agent, unmatched ones under Other sessions, shells never", () => {
  const panes = [shell(1), ai(2, "claude"), ai(3, "grok"), ai(4, "claude"), { key: 5, program: null, cwd: null, seats: [{ agent: null }] }];
  const groups = railGroups(panes, saved);
  expect(groups.map((g) => [g.id, g.name, g.sessions.map((p) => p.key)])).toEqual([
    ["claude", "Claude Code", [2, 4]],
    ["codex", "Codex", []],
    ["other", "Other sessions", [3]],
  ]);
  expect(railGroups([shell(1)], saved).map((g) => g.id)).toEqual(["claude", "codex"]);
});

test("VIEW-021: a not-started preset sits under its agent; editor and browser tabs are never listed", () => {
  const panes = [ai(1, "codex", { kind: "editor" }), { key: 2, program: null, cwd: null, seats: [{ agent: "codex" }] }, ai(3, "claude", { kind: "browser" })];
  expect(railGroups(panes, saved).map((g) => g.sessions.map((p) => p.key))).toEqual([[], [2]]);
});

test("VIEW-015: first open picks the first agent with sessions on its newest session; a remembered pick stays while it exists", () => {
  const groups = railGroups([ai(2, "claude"), ai(7, "grok"), ai(4, "claude")], saved);
  expect(pickSession(groups, null)).toBe(4);
  expect(pickSession(groups, 2)).toBe(2);
  expect(pickSession(groups, 9)).toBe(4);
  expect(pickSession(railGroups([ai(7, "grok")], saved), null)).toBe(7);
  expect(pickSession(railGroups([shell(1)], saved), null)).toBe(null);
});

test("VIEW-015: a session reads as its task's name, else its folder, else its number", () => {
  expect(sessionLabel({ key: 3, title: "Fix login", cwd: "C:/w/app" })).toBe("Fix login");
  expect(sessionLabel({ key: 3, cwd: "C:/w/app" })).toBe("app");
  expect(sessionLabel({ key: 3, cwd: null })).toBe("Session 3");
});

test("VIEW-024: the Board's cards are the terminal panes in order; editor and browser tabs get none", () => {
  const panes = [shell(1), ai(2, "claude", { kind: "editor" }), { key: 3, program: null, cwd: null, seats: [{ agent: null }] }, ai(4, "claude", { kind: "browser" }), ai(5, "codex")];
  expect(cardPanes(panes).map((p) => p.key)).toEqual([1, 3, 5]);
});
