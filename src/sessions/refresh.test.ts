import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import AgentsPanel from "./AgentsPanel";
import { AFTER_START_MS, MAX_LATE_MS, publishDelay, QUIET_MS, recall, remember, RescanLimiter, RESCAN_EVERY_MS } from "./refresh";
import { dragPayload, NO_TURNS, readDrag, resumeBlock, shellProgram } from "./resume";

test("VIEW-083: results arriving while nobody types are drawn at once", () => {
  expect(publishDelay(1000, 0, 1000)).toBe(0);
  expect(publishDelay(5000, 1000, 5000)).toBe(0);
});

test("VIEW-083: results arriving during typing wait for a pause of 300 ms", () => {
  expect(QUIET_MS).toBe(300);
  expect(publishDelay(1000, 900, 1000)).toBe(200);
  expect(publishDelay(1000, 1000, 1000)).toBe(300);
});

test("VIEW-083: steady typing never holds results more than one second past their arrival", () => {
  expect(MAX_LATE_MS).toBe(1000);
  // keys every 100 ms keep pushing the quiet point away; the cap still releases the list at arrival + 1 s
  expect(publishDelay(2000, 1990, 2000)).toBe(290);
  expect(publishDelay(2900, 2890, 2000)).toBe(100);
  expect(publishDelay(3000, 2990, 2000)).toBe(0);
  expect(publishDelay(3500, 3499, 2000)).toBe(0);
});

test("VIEW-083: an agent start triggers at most one rescan per interval", () => {
  const l = new RescanLimiter();
  expect(l.allow(10_000)).toBe(true);
  expect(l.allow(10_000 + RESCAN_EVERY_MS - 1)).toBe(false);
  expect(l.allow(10_000 + RESCAN_EVERY_MS)).toBe(true);
  expect(AFTER_START_MS).toBeGreaterThan(0);
});

test("VIEW-083: reopening the tab reuses the last results for that scope", () => {
  expect(recall("scope-x")).toBeUndefined();
  remember("scope-x", [{ id: "a" }]);
  expect(recall("scope-x")).toEqual([{ id: "a" }]);
});

const row = (over: Record<string, unknown> = {}) => ({ agent: "claude", id: "s1", title: "Fix login", modifiedMs: Date.now() - 120_000, bytes: 10, turns: 2, dir: "C:/w", ...over });

test("VIEW-085: a session with no turns cannot be resumed; one with turns can", () => {
  expect(resumeBlock({ turns: 0 })).toBe(NO_TURNS);
  expect(resumeBlock({ turns: 1 })).toBeNull();
});

test("VIEW-085: the copied command is written for the shell the target tab really runs", () => {
  expect(shellProgram("cmd.exe", "wsl.exe")).toBe("cmd.exe");
  expect(shellProgram("  ", "pwsh")).toBe("pwsh");
  expect(shellProgram(null, null)).toBeNull();
});

test("VIEW-085: a dragged session names its agent and id, and a bad payload reads as nothing", () => {
  expect(readDrag(dragPayload({ agent: "codex", id: "019a" }))).toEqual({ agent: "codex", id: "019a" });
  expect(readDrag("not json")).toBeNull();
  expect(readDrag('{"agent":"x"}')).toBeNull();
});

test("VIEW-080: the Agents tab draws cached rows at once with Resume and Copy command, Resume off for a session without turns", () => {
  const props = { settings: {}, onSave: () => {}, activeDir: "C:/w", projectDirs: [], rescanKey: 0, visible: true, shell: null, onResume: () => {} };
  remember(JSON.stringify([false, ["C:/w"], 200]), [row(), row({ id: "s2", title: "", turns: 0 })]);
  const html = renderToString(createElement(AgentsPanel, props));
  expect(html).toContain("Fix login");
  expect(html).toContain("Untitled session");
  expect(html).toContain("2 past sessions");
  expect(html).toContain("Copy command");
  expect((html.match(/disabled=""/g) ?? []).length).toBe(1);
  expect(html).toContain("2 min ago");
});

test("VIEW-080: a scope with nothing says so in one sentence", () => {
  remember(JSON.stringify([true, [], null]), []);
  const html = renderToString(createElement(AgentsPanel, { settings: { sessionListScope: { scope: "all", manual: true }, sessionListView: { depth: null } }, onSave: () => {}, activeDir: null, projectDirs: [], rescanKey: 0, visible: true, shell: null, onResume: () => {} }));
  expect(html).toContain("No past sessions here yet");
});
