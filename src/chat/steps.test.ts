import { describe, expect, it } from "vitest";
import type { ChatItem, Row } from "./model";
import { diffLineKind, diffText, duration, fold, linkParts, looksLikeDiff, type Tool } from "./steps";

const msg = (item: ChatItem): Row => ({ ...item, row: "message" });
const user = (id: string, at: number) => msg({ id, role: "user", kind: "text", text: "go", at });
const say = (id: string, at: number) => msg({ id, role: "assistant", kind: "text", text: "ok", at });
const tool = (id: string, at: number, t: Partial<Tool>) =>
  msg({ id, role: "assistant", kind: "tool", text: "", at, tool: { call: id, name: "Bash", group: "shell", preview: "ls", done: false, failed: false, background: false, ...t } });

describe("fold (CHAT-013..CHAT-016)", () => {
  it("three commands run → one live line while they run, one folded row afterwards", () => {
    const running = [user("u", 0), tool("a", 1000, { done: true }), tool("b", 2000, { done: true }), tool("c", 3000, {})];
    const live = fold(running, true);
    expect(live.map((v) => v.row)).toEqual(["message", "steps", "working"]);
    const steps = live[1] as Extract<ReturnType<typeof fold>[number], { row: "steps" }>;
    expect([steps.live, steps.steps.length]).toEqual([true, 3]);
    const settled = fold([...running.slice(0, 3), tool("c", 3000, { done: true, endedAt: 5000 }), say("m", 6000)], false);
    expect(settled.map((v) => v.row)).toEqual(["message", "steps", "message", "worked"]);
    expect((settled[1] as { live: boolean }).live).toBe(false);
    expect((settled[3] as { ms: number }).ms).toBe(6000);
  });

  it("worked-for sits under the last reply; a later compaction neither moves nor lengthens it", () => {
    const compact = msg({ id: "c", role: "status", kind: "compact", text: "Context compacted", at: 90_000 });
    const v = fold([user("u", 0), say("m", 4000), compact, user("u2", 95_000)], false);
    expect(v.map((x) => x.row)).toEqual(["message", "message", "worked", "message", "message"]);
    expect((v[2] as { ms: number }).ms).toBe(4000);
  });

  it("prose between tool calls splits them; an edit is its own diff card", () => {
    const v = fold([user("u", 0), tool("a", 1, {}), say("m", 2), tool("b", 3, {}), tool("e", 4, { group: "edit", diffs: [] }), tool("c", 5, {})], false);
    expect(v.map((x) => x.row)).toEqual(["message", "steps", "message", "steps", "diff", "steps"]);
  });

  it("two subagents → one roster row with two working, then a summary that two ran", () => {
    const agent = (id: string, t: Partial<Tool>) => tool(id, 10, { group: "agent", name: "reviewer", preview: id, ...t });
    const working = fold([user("u", 0), agent("x", {}), say("m", 11), agent("y", {})], true);
    const row = working.find((v) => v.row === "roster") as Extract<ReturnType<typeof fold>[number], { row: "roster" }>;
    expect(working.filter((v) => v.row === "roster")).toHaveLength(1);
    expect(row.children.map((c) => c.state)).toEqual(["working", "working"]);
    const done = fold([user("u", 0), agent("x", { done: true }), agent("y", { done: true, failed: true })], false);
    const summary = done.find((v) => v.row === "roster") as typeof row;
    expect([summary.children.map((c) => c.state), summary.verdict]).toEqual([["completed", "failed"], "failed"]);
  });

  it("children left running from an earlier app run are unverifiable; an interrupt stops them", () => {
    const rows = [user("u", 0), tool("x", 1, { group: "agent" })];
    const restored = fold(rows, false).find((v) => v.row === "roster") as { children: { state: string }[] };
    expect(restored.children[0].state).toBe("unverifiable");
    const stopped = fold([...rows, msg({ id: "i", role: "status", kind: "interrupted", text: "Interrupted", at: 2 })], true);
    expect((stopped.find((v) => v.row === "roster") as typeof restored).children[0].state).toBe("stopped");
    expect(stopped.some((v) => v.row === "working")).toBe(false);
  });

  it("background work is monitoring; a pending send shows responding", () => {
    const v = fold([user("u", 0), tool("b", 1, { background: true, done: true }), { row: "pending", id: "p", text: "more", at: 3 }], true);
    expect(v.find((x) => x.row === "working")).toMatchObject({ label: "Monitoring background work", since: 0 });
    expect(v[v.length - 1].row).toBe("responding");
    expect(fold([user("u", 0)], false).some((x) => x.row === "responding" || x.row === "working")).toBe(false);
  });
});

describe("diffs and results (CHAT-013, CHAT-014)", () => {
  it("a copied diff marks every changed line with a plus or a minus", () => {
    const text = diffText({ path: "a", change: "edited", hidden: 0, lines: [{ sign: " ", text: "keep" }, { sign: "-", text: "old" }, { sign: "@", text: "" }, { sign: "+", text: "new" }] });
    expect(text).toBe(" keep\n-old\n+new");
  });
  it("only text with hunk headers is coloured, and a row of dashes is a divider", () => {
    expect(looksLikeDiff("---\n- item")).toBe(false);
    expect(looksLikeDiff("@@ -1,2 +1,2 @@\n-a\n+b")).toBe(true);
    expect(["-----", "--- a/x", "-a", "+b", "@@ -1 +1 @@"].map(diffLineKind)).toEqual(["rule", "head", "del", "add", "hunk"]);
  });
  it("only web links can be clicked", () => {
    expect(linkParts("see https://example.com/x. or file:///c/x")).toEqual([{ text: "see " }, { text: "https://example.com/x", url: "https://example.com/x" }, { text: ". or file:///c/x" }]);
  });
  it("durations read short", () => {
    expect([duration(42_000), duration(65_000), duration(3_720_000)]).toEqual(["42s", "1m 05s", "1h 02m"]);
  });
});
