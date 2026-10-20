import { beforeEach, expect, test, vi } from "vitest";
import type { RepoSetup } from "./setupChoice";

const calls = vi.hoisted(() => ({ list: [] as [string, unknown][], reply: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    calls.list.push([cmd, args]);
    return calls.reply instanceof Error ? Promise.reject(calls.reply) : Promise.resolve(calls.reply);
  },
}));
import { probeSetup } from "./setupProbe";

const page: RepoSetup = { local: null, shared: null, sharedError: null, policy: null, inherited: "local", wait: false, suggestBoth: false, runError: null };

beforeEach(() => {
  calls.list = [];
  calls.reply = page;
});

test("FIX-1: the probe reads the page's setup, so it never asks the runner and never meets a trust refusal", async () => {
  calls.reply = { ...page, local: "make", shared: "pnpm i", policy: "both" };
  expect(await probeSetup("C:/w/one", false), "a saved setup next to an untrusted kolux.yaml under both counts").toBe(true);
  expect(calls.list).toEqual([["repo_setup_get", { path: "C:/w/one" }]]);
});

test("FIX-1: no script for the choice in force is no setup; a failed read answers as asked", async () => {
  expect(await probeSetup("C:/w/two", true)).toBe(false);
  calls.reply = { ...page, local: "make", policy: "shared" };
  expect(await probeSetup("C:/w/two", true), "kolux.yaml only, and it has none").toBe(false);
  calls.reply = new Error("boom");
  expect(await probeSetup("C:/w/two", true), "a picker keeps the option").toBe(true);
  expect(await probeSetup("C:/w/two", false), "a count does not guess").toBe(false);
});
