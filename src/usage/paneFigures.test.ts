import { afterEach, expect, test } from "vitest";
import { accountsToRead } from "./paneFigures";
import { publishCodexFor, readPlan } from "./plan";
import type { CodexUsage } from "./codex";

const ok: CodexUsage = { state: "ok", fiveHour: { usedPercent: 10, resetsAt: null, windowMins: 300 }, weekly: null, resetCredits: null, plan: null, message: null };
afterEach(() => (publishCodexFor("b", null), publishCodexFor(null, null)));

test("T-548-b: reads one account per distinct Codex pane account other than the active one, in pane order", () => {
  const panes = [
    { agent: "codex", account: "b" },
    { agent: "codex", account: "a" },
    { agent: "claude", account: "x" },
    { agent: "codex", account: "b" },
    { agent: "codex", account: null },
    { agent: "codex" },
    { agent: "shell", account: "z" },
  ];
  expect(accountsToRead(panes, "a")).toEqual(["b", null]);
  expect(accountsToRead(panes, null)).toEqual(["b", "a"]); // the system default is the active one
  expect(accountsToRead([{ agent: "codex", account: "a" }], "a")).toEqual([]);
  expect(accountsToRead([], "a")).toEqual([]);
});

test("T-548-b: figures are kept per account, replaced on a new read and dropped with null", () => {
  publishCodexFor("b", ok);
  publishCodexFor(null, { ...ok, plan: "plus" });
  expect(readPlan().codexBy?.b).toBe(ok);
  expect(readPlan().codexBy?.[""]?.plan).toBe("plus");
  const newer = { ...ok, fiveHour: { usedPercent: 50, resetsAt: null, windowMins: 300 } };
  publishCodexFor("b", newer);
  expect(readPlan().codexBy?.b).toBe(newer);
  publishCodexFor("b", null);
  expect(readPlan().codexBy?.b).toBeUndefined();
  expect(readPlan().codexBy?.[""]).toBeDefined();
});
