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
    const rows = [row({}), row({ last: 9_000 + SETTLE_MS }), row({ session: "before", last: 999 }), row({ session: "after", last: 9_001 + SETTLE_MS }), row({ session: "elsewhere", cwd: "G:/work/other" })];
    const u = runUsage(run({}), usage(rows), undefined, "new-per-run");
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
    const u = runUsage(run({}), usage([row({ model: "made-up-model-9" })]), undefined, "new-per-run")!;
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
    expect(totalUsage(runs, usage(rows), undefined, "new-per-run")).toMatch(/^3,000 tokens over 2 runs · (\$\d+\.\d\d|under \$0\.01)$/);
    expect(totalUsage([run({ status: "dispatched" })], usage(rows))).toBe("Not recorded yet: no run has finished");
    expect(totalUsage([run({ provider: "gemini" })], usage(rows), "Gemini")).toBe("Not supported: Gemini keeps no local usage record");
    expect(totalUsage([run({}), run({ id: "r2", worktree: "G:/work/wt-2" })], usage([row({}), row({ cwd: "G:/work/wt-2", model: "made-up-model-9" })]), undefined, "new-per-run")).toMatch(/cost unavailable$/);
  });
});

describe("AUTO-014 a shared folder (council MERGE 50)", () => {
  // An existing-mode run works in the project's own folder, where the user's own all-day session
  // also writes usage; only the run's recorded session may be billed to it.
  const mine = row({ session: "run-session", input: 200, output: 100 });
  const users = row({ session: "users-own", input: 90_000, output: 9_000, last: 6_000 });
  it("an existing-mode run without its session id reads unavailable, never the user's session", () => {
    const u = runUsage(run({}), usage([mine, users]), undefined, "existing")!;
    expect(u).toMatchObject({ kind: "unavailable" });
    expect(usageWord(u)).toContain("shares its folder");
    expect(runUsage(run({}), usage([mine]), undefined, undefined)!.kind).toBe("unavailable");
  });
  it("the run's recorded session is matched by id, wherever its folder is", () => {
    expect(runUsage(run({ sessionId: "run-session" }), usage([mine, users]), undefined, "existing")).toMatchObject({ kind: "matched", tokens: 300 });
  });
  it("a new worktree with two sessions in the window reads unavailable", () => {
    const u = runUsage(run({}), usage([mine, users]), undefined, "new-per-run")!;
    expect(usageWord(u)).toBe("Unavailable: more than one session used the run's folder while it ran");
  });
});

describe("AUTO-014 the opened run", () => {
  it("shows the saved output and the run's tokens and spend; an agent with no usage record reads unsupported", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { RunPage } = await import("./RunsDashboard");
    const page = (r: Run) => renderToString(createElement(RunPage, { run: { sessionId: "s-1", ...r }, automation: undefined, now: 10_000, usage: usage([row({})]), agentName: r.provider === "gemini" ? "Gemini" : "Claude", onRuns: () => {}, onAutomations: () => {} }));
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
