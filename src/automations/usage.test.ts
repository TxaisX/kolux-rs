import { describe, expect, it } from "vitest";
import type { Row, Usage } from "../usage/tokens";
import type { Run } from "./model";
import { runUsage, SETTLE_MS, totalUsage, usageWord } from "./usage";

// Invented figures; no value comes from a real log.
const row = (o: Partial<Row>): Row => ({ day: "2026-10-13", session: "s-1", model: "claude-opus-5", cwd: "G:\\work\\wt-1", band: 0, input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 5_000, ...o });
const run = (o: Partial<Run>): Run => ({ id: "r1", automationId: "a1", number: 1, trigger: "manual", status: "completed", at: 1_000, dispatchedAt: 1_000, finishedAt: 9_000, worktree: "G:/work/wt-1/", provider: "claude", ...o });
const usage = (rows: Row[], o: Partial<Usage> = {}): Usage => ({ tracking: { claude: true, codex: true }, claude: { scannedAt: 1, rows, error: null }, codex: { scannedAt: 1, rows: [], error: null }, ...o });

describe("AUTO-014 run usage", () => {
  it("matches the agent's replies in the run's worktree between its start and just after its end", () => {
    const rows = [row({}), row({ session: "s-2", last: 9_000 + SETTLE_MS }), row({ session: "before", last: 999 }), row({ session: "after", last: 9_001 + SETTLE_MS }), row({ session: "elsewhere", cwd: "G:/work/other" })];
    const u = runUsage(run({}), usage(rows));
    expect(u).toMatchObject({ kind: "matched", tokens: 3000 });
    expect(u?.kind === "matched" && u.usd !== null && u.usd > 0).toBe(true);
  });

  it("an agent that stores no usage reads unsupported, and an unmatched run reads unavailable, never 0", () => {
    expect(usageWord(runUsage(run({ provider: "gemini" }), usage([]), "Gemini")!)).toBe("Not supported: Gemini keeps no local usage record");
    const none = runUsage(run({}), usage([]))!;
    expect(none.kind).toBe("unavailable");
    expect(usageWord(none)).not.toMatch(/\b0\b|\$0/);
    expect(runUsage(run({}), usage([row({})], { tracking: { claude: false, codex: true } }))).toEqual({ kind: "unavailable", why: "token tracking is off for this agent" });
    expect(runUsage(run({}), null)?.kind).toBe("unavailable");
  });

  it("a model with no known price makes the cost unavailable, not a smaller number", () => {
    const u = runUsage(run({}), usage([row({ model: "made-up-model-9" })]))!;
    expect(u).toMatchObject({ kind: "matched", tokens: 1500, usd: null });
    expect(usageWord(u)).toContain("cost unavailable");
  });

  it("runs still going, skipped or never handed to an agent show no usage line", () => {
    expect(runUsage(run({ status: "dispatched" }), usage([row({})]))).toBeNull();
    expect(runUsage(run({ status: "skipped", dispatchedAt: undefined }), usage([row({})]))).toBeNull();
    expect(runUsage(run({ status: "failed", worktree: undefined }), usage([row({})]))).toBeNull();
  });

  it("the automation's row adds usage up across its runs", () => {
    const rows = [row({ last: 5_000 }), row({ session: "s-2", last: 105_000 })];
    const runs = [run({}), run({ id: "r2", number: 2, at: 100_000, dispatchedAt: 100_000, finishedAt: 106_000 }), run({ id: "r3", number: 3, status: "dispatched" })];
    expect(totalUsage(runs, usage(rows))).toMatch(/^3,000 tokens over 2 runs · (\$\d+\.\d\d|under \$0\.01)$/);
    expect(totalUsage([run({ status: "dispatched" })], usage(rows))).toBe("Not recorded yet: no run has finished");
    expect(totalUsage([run({ provider: "gemini" })], usage(rows), "Gemini")).toBe("Not supported: Gemini keeps no local usage record");
    expect(totalUsage([run({}), run({ id: "r2", worktree: "G:/work/wt-2" })], usage([row({}), row({ cwd: "G:/work/wt-2", model: "made-up-model-9" })]))).toMatch(/cost unavailable$/);
  });
});

describe("AUTO-014 the opened run", () => {
  it("shows the saved output and the run's tokens and spend; an agent with no usage record reads unsupported", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { RunPage } = await import("./RunsDashboard");
    const page = (r: Run) => renderToString(createElement(RunPage, { run: r, automation: undefined, now: 10_000, usage: usage([row({})]), agentName: r.provider === "gemini" ? "Gemini" : "Claude", onRuns: () => {}, onAutomations: () => {} }));
    const html = page(run({ output: "Done: 3 files changed", outputFrom: "screen", outputCut: true }));
    expect(html).toContain("Saved output");
    expect(html).toContain("Done: 3 files changed");
    expect(html).toContain("older lines were left out");
    expect(html).toMatch(/1,500 tokens · \$\d+\.\d\d/);
    const other = page(run({ provider: "gemini" }));
    expect(other).toContain("Not supported: Gemini keeps no local usage record");
    expect(other).toContain("No output was saved for this run");
  });
});
