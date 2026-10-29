import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import type { AgentInfo } from "./PlusMenu";
import { AgentPickerView } from "./AgentPicker";
import wizard from "../onboarding/StepPanels.tsx?raw";
import settings from "../settings/AgentsPage.tsx?raw";
import onboarding from "../../src-tauri/src/onboarding.rs?raw";
import { afterBatch, applyEvent, mergeResults, queueAll, rowWords, running, selectAll, selectedCount, selectedIds, startTicks, type InstallResult } from "./pickerRules";

const agent = (id: string, o: Partial<AgentInfo> = {}): AgentInfo => ({ id, name: id.toUpperCase(), program: id, args: [], installed: false, path: null, installable: true, install: `npm i -g ${id}`, ...o });
const list = [agent("claude", { installed: true, path: "C:/claude.exe" }), agent("codex"), agent("pi"), agent("ante", { installable: false, install: null })];

const view = (o: Partial<Parameters<typeof AgentPickerView>[0]> = {}) =>
  renderToString(createElement(AgentPickerView, { agents: list, ticks: startTicks(list), progress: {}, busy: false, onToggle: () => {}, onAll: () => {}, onNone: () => {}, onInstall: () => {}, onWebsite: () => {}, ...o }));

test("every installable agent that is not installed starts ticked; the rest do not", () => {
  expect(startTicks(list)).toEqual(["codex", "pi"]);
  expect(selectAll(list)).toEqual(["codex", "pi"]);
  expect(startTicks([])).toEqual([]);
});

test("N counts only installable, not-installed ticks", () => {
  expect(selectedCount(list, ["claude", "codex", "pi", "ante"])).toBe(2); // installed and website-only ticks never count
  expect(selectedCount(list, ["pi"])).toBe(1);
  expect(selectedCount(list, [])).toBe(0);
  expect(selectedIds(list, ["claude", "codex", "ante"])).toEqual(["codex"]);
});

test("the view names the section, the buttons and N; Install is disabled at 0", () => {
  const html = view();
  expect(html).toContain("Install coding agents");
  expect(html).toContain("Select all");
  expect(html).toContain("Select none");
  expect(html).toContain("Install selected (2)");
  expect(html).not.toMatch(/btn primary"[^>]*disabled/);
  const none = view({ ticks: [] });
  expect(none).toContain("Install selected (0)");
  expect(none).toMatch(/<button[^>]*class="btn primary"[^>]*disabled|<button[^>]*disabled[^>]*class="btn primary"/);
});

test("installed rows read Installed, ticked and disabled; website-only rows get the website button", () => {
  const html = view();
  const claude = html.slice(html.indexOf('data-agent="claude"'), html.indexOf('data-agent="codex"'));
  expect(claude).toContain("Installed");
  expect(claude).toContain('checked=""');
  expect(claude).toContain('disabled=""');
  const codex = html.slice(html.indexOf('data-agent="codex"'), html.indexOf('data-agent="pi"'));
  expect(codex).toContain('checked=""');
  expect(codex).not.toContain('disabled=""');
  expect(codex).toContain('title="npm i -g codex"');
  const ante = html.slice(html.indexOf('data-agent="ante"'));
  expect(ante).toContain("Install from its website");
  expect(ante).not.toContain('checked=""');
});

test("progress words follow the event states and failures show the error as it came", () => {
  let p = queueAll(["codex", "pi"]);
  expect(rowWords(list[1], p)).toBe("Waiting");
  expect(running(p)).toBe(true);
  p = applyEvent(p, { id: "codex", state: "installing" });
  expect(rowWords(list[1], p)).toBe("Installing…");
  p = applyEvent(p, { id: "codex", state: "ok" });
  p = applyEvent(p, { id: "pi", state: "failed", error: "npm exited with code 1" });
  expect(rowWords(list[1], p)).toBe("Installed");
  expect(rowWords(list[2], p)).toBe("Failed: npm exited with code 1");
  expect(running(p)).toBe(false);
  const html = view({ progress: p });
  expect(html).toContain("Failed: npm exited with code 1");
  // A failed row can be tried again; a running or finished one cannot.
  expect(selectedIds(list, ["codex", "pi"], p)).toEqual(["pi"]);
  expect(view({ progress: queueAll(["codex", "pi"]), busy: true })).toContain("Waiting");
});

test("when the batch ends the list is refreshed from the returned results", () => {
  const results: InstallResult[] = [
    { id: "codex", ok: true, agent: { ...list[1], installed: true, path: "C:/codex.cmd" } },
    { id: "pi", ok: false, error: "No network", agent: null },
  ];
  const next = mergeResults(list, results);
  expect(next.find((a) => a.id === "codex")).toMatchObject({ installed: true, path: "C:/codex.cmd" });
  expect(next.find((a) => a.id === "pi")?.installed).toBe(false);
  expect(next.find((a) => a.id === "claude")).toBe(list[0]);
  const p = afterBatch(queueAll(["codex", "pi"]), results);
  expect(rowWords(next[2], p)).toBe("Failed: No network");
  expect(selectedCount(next, ["codex", "pi"], p)).toBe(1);
  // A success that carries no agent still marks the row installed.
  expect(mergeResults(list, [{ id: "pi", ok: true }]).find((a) => a.id === "pi")?.installed).toBe(true);
});

test("the heading level follows where the checklist sits", () => {
  expect(view()).toContain("<h2");
  expect(view({ level: 3 })).toContain("<h3");
});

test("the checklist is mounted in the Connect an AI step and in Settings > Agents, and no wizard screen was added", () => {
  expect(wizard).toContain("<AgentPicker ");
  expect(settings).toContain("<AgentPicker ");
  expect(onboarding).toMatch(/const LAST: i32 = 3;/);
});
