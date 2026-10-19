// CHAT-023 (T-329): the permission card. Hook events (stand-ins) fold into a per-pane prompt record; the card
// shows while a named tool's prompt is open and not answered; Allow / Deny type the program's keys only while
// that prompt is still the one showing; a dismissed prompt stays dismissed until the next one.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askOf, askTitle, answerCard, cardOf, dismissAsk, forgetAsks, hearAsks, subscribeAsk, takeAsk } from "./ask";
import { forgetHearing, hearStates, setClock } from "./send";

type Handler = (e: { payload: Record<string, unknown> }) => void;
const handlers: Handler[] = [];
const listen = async (_n: string, h: Handler) => {
  handlers.push(h);
  return () => {};
};
const emit = (p: Record<string, unknown>) => handlers.forEach((h) => h({ payload: p }));
const writes: { id: number; data: string }[] = [];
const deps = (terminal: number | null = 70) => ({ terminalOf: () => terminal ?? undefined, write: async (id: number, data: string) => void writes.push({ id, data }) });

beforeEach(async () => {
  writes.length = 0;
  handlers.length = 0;
  setClock(() => 0);
  await hearAsks(listen as never);
  await hearStates(listen as never);
});
afterEach(() => {
  forgetAsks();
  forgetHearing();
});

const ask = (extra: Record<string, unknown> = {}) => emit({ paneKey: 1, state: "permission", tool: "Bash", detail: "rm -rf build", terminal: 70, ...extra });

describe("the card", () => {
  it("shows Allow Bash? for a Claude shell command, with the command as detail", () => {
    ask();
    const card = cardOf("claude", askOf(1), 70);
    expect(card).toMatchObject({ tool: "Bash", detail: "rm -rf build", review: false });
    expect(askTitle("Bash")).toBe("Allow Bash?");
  });
  it("offers Review plan when the request is to leave plan mode", () => {
    ask({ tool: "ExitPlanMode", detail: undefined, plan: "# Plan\n1. do it" });
    expect(cardOf("claude", askOf(1), 70)?.review).toBe(true);
  });
  it("shows no card for a shell, OpenClaude, an unnamed tool, another working state, or an event from another terminal", () => {
    ask();
    expect(cardOf("shell", askOf(1), 70)).toBeNull();
    expect(cardOf("openclaude", askOf(1), 70)).toBeNull();
    expect(cardOf(undefined, askOf(1), 70)).toBeNull();
    expect(cardOf("claude", askOf(1), 71)).toBeNull();
    emit({ paneKey: 2, state: "permission", terminal: 80 });
    expect(cardOf("claude", askOf(2), 80)).toBeNull();
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    expect(cardOf("claude", askOf(1), 70)).toBeNull();
  });
  it("tracks separate approvals on their own: a second prompt after an answered one is a new card", async () => {
    ask();
    const first = cardOf("claude", askOf(1), 70)!;
    expect(await answerCard(1, "claude", "approve", first.drawnAt, deps())).toBe("sent");
    expect(cardOf("claude", askOf(1), 70)).toBeNull();
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    ask({ tool: "Write", detail: "a.txt" });
    const second = cardOf("claude", askOf(1), 70)!;
    expect(second.tool).toBe("Write");
    expect(second.drawnAt).toBe(first.drawnAt + 1);
  });
  it("a dismissed card stays dismissed, even when the hook repeats the same prompt", () => {
    ask();
    const card = cardOf("claude", askOf(1), 70)!;
    let pokes = 0;
    const off = subscribeAsk(() => void pokes++);
    dismissAsk(1, card.drawnAt);
    expect(pokes).toBe(1);
    ask();
    expect(cardOf("claude", askOf(1), 70)).toBeNull();
    off();
  });
  it("takeAsk keeps what the prompt told when the same prompt is reported again without it", () => {
    const a = takeAsk(undefined, { paneKey: 1, state: "permission", tool: "Bash", detail: "ls", terminal: 70 });
    const b = takeAsk(a, { paneKey: 1, state: "permission" });
    expect(b).toMatchObject({ count: 1, tool: "Bash", detail: "ls" });
    expect(takeAsk(b, { paneKey: 1 })).toBe(b);
  });
});

describe("Allow and Deny", () => {
  it("Claude: Allow types Enter (Yes is highlighted), Deny types Escape", async () => {
    ask();
    await answerCard(1, "claude", "approve", askOf(1)!.count, deps());
    expect(writes).toEqual([{ id: 70, data: "\r" }]);
    writes.length = 0;
    emit({ paneKey: 1, state: "working", terminal: 70 });
    ask({ tool: "Bash" });
    await answerCard(1, "claude", "deny", askOf(1)!.count, deps());
    expect(writes).toEqual([{ id: 70, data: "\x1b" }]);
  });
  it("Codex: Allow types y, Deny types n", async () => {
    ask();
    await answerCard(1, "codex", "approve", askOf(1)!.count, deps());
    emit({ paneKey: 1, state: "working", terminal: 70 });
    ask();
    await answerCard(1, "codex", "deny", askOf(1)!.count, deps());
    expect(writes.map((w) => w.data)).toEqual(["y", "n"]);
  });
  it("a stale click types nothing: the card was drawn for an earlier prompt, or the agent moved on", async () => {
    ask();
    const drawn = askOf(1)!.count;
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("gone");
    ask();
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("gone");
    expect(writes).toEqual([]);
  });
  it("a second click on the same card types nothing", async () => {
    ask();
    const drawn = askOf(1)!.count;
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("sent");
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("gone");
    expect(writes).toHaveLength(1);
  });
  it("types nothing when the pane's terminal is not the one the prompt came from, or there is none", async () => {
    ask();
    expect(await answerCard(1, "claude", "approve", askOf(1)!.count, deps(71))).toBe("gone");
    emit({ paneKey: 1, state: "working", terminal: 70 });
    ask();
    expect(await answerCard(1, "claude", "approve", askOf(1)!.count, deps(null))).toBe("no-terminal");
    expect(writes).toEqual([]);
  });
});
