// CHAT-018 (T-329): Stop interrupts the agent. The button's modes and double-click guard (stop.ts), and
// stopPane (send.ts): a send still waiting is cancelled before Escape goes out; Escape never goes into a menu.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STOP_ARM_MS, buttonMode, stopArmed } from "./stop";
import { CANCELLED_NOTE, INTERRUPT_KEY, boxSend, forgetHearing, hearStates, setClock, sendToPane, stopPane } from "./send";

type Handler = (e: { payload: unknown }) => void;
const handlers: Handler[] = [];
const listen = async (_n: string, h: Handler) => {
  handlers.push(h);
  return () => {};
};
const emit = (p: unknown) => handlers.forEach((h) => h({ payload: p }));
const writes: { id: number; data: string }[] = [];
const write = async (id: number, data: string) => void writes.push({ id, data });
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
beforeEach(async () => {
  writes.length = 0;
  handlers.length = 0;
  setClock(() => 0);
  await hearStates(listen as never);
});
afterEach(() => forgetHearing());

describe("the Send / Stop button", () => {
  it("reads Stop while the agent works, and Send when it is idle or asking", () => {
    expect(buttonMode(true, false)).toBe("stop");
    expect(buttonMode(false, false)).toBe("send");
    expect(buttonMode(true, true)).toBe("send");
  });
  it("a Stop within 700 ms of a send from the box is the second click of a double-click and does nothing", () => {
    expect(STOP_ARM_MS).toBe(700);
    expect(stopArmed(1000, 1000)).toBe(false);
    expect(stopArmed(1000, 1699)).toBe(false);
    expect(stopArmed(1000, 1700)).toBe(true);
    expect(stopArmed(null, 0)).toBe(true);
  });
});

describe("stopPane", () => {
  const deps = (state: string | undefined, terminal: number | null = 70) => ({ terminalOf: () => terminal ?? undefined, stateOf: () => state, write });

  it("types Escape into the pane's terminal", async () => {
    emit({ paneKey: 1, state: "working", terminal: 70 });
    expect(await stopPane(1, deps("working"))).toBe("stopped");
    expect(writes).toEqual([{ id: 70, data: INTERRUPT_KEY }]);
    expect(INTERRUPT_KEY).toBe("\x1b");
  });
  it("types nothing while the agent asks in its terminal: Escape there would answer the question", async () => {
    emit({ paneKey: 1, state: "permission", terminal: 70 });
    expect(await stopPane(1, deps("permission"))).toBe("asking");
    expect(await stopPane(1, deps("working"))).toBe("asking");
    expect(writes).toEqual([]);
  });
  it("says so when the pane has no terminal", async () => {
    expect(await stopPane(1, deps("working", null))).toBe("no-terminal");
    expect(writes).toEqual([]);
  });
  it("cancels a send that is waiting in the queue before the interrupt goes out: its Enter is never typed", async () => {
    emit({ paneKey: 1, state: "working", terminal: 70 });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    // the first send is mid-way (waiting between its writes); the second waits behind it in the queue
    const slow = async (ms: number) => void (ms > 0 && (await gate));
    const d = { terminalOf: () => 70, stateOf: () => "working", write, sleep: slow };
    const first = sendToPane(1, "claude", "first", d);
    await flush();
    const second = sendToPane(1, "claude", "second", { ...d, sleep: async () => {} });
    await flush();
    const stopped = stopPane(1, { terminalOf: () => 70, stateOf: () => "working", write });
    release();
    expect(await first).toBe("cancelled");
    expect(await second).toBe("cancelled");
    expect(await stopped).toBe("stopped");
    // only the first send's line-clear and paste went in (before Stop), then Escape; no Enter, nothing of "second"
    expect(writes.some((w) => w.data === "\r")).toBe(false);
    expect(writes.some((w) => w.data.includes("second"))).toBe(false);
    expect(writes[writes.length - 1]).toEqual({ id: 70, data: INTERRUPT_KEY });
  });
  it("a send made after Stop goes through normally", async () => {
    emit({ paneKey: 1, state: "working", terminal: 70 });
    await stopPane(1, deps("working"));
    expect(await sendToPane(1, "claude", "again", { ...deps("working"), sleep: async () => {} })).toBe("sent");
  });
});

describe("a cancelled box send", () => {
  it("drops its waiting row and says Stop cancelled it, instead of marking it failed", async () => {
    emit({ paneKey: 1, state: "working", terminal: 70 });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const notes: (string | null)[] = [];
    let cancelled = 0;
    let failed = 0;
    const d = { terminalOf: () => 70, stateOf: () => "working", write, sleep: async (ms: number) => void (ms > 0 && (await gate)) };
    expect(boxSend(1, "claude", "hello", d, { note: (n) => notes.push(n), onQueued: () => {}, onFailed: () => void failed++, onCancelled: () => void cancelled++ })).toBe(true);
    await flush();
    const stopped = stopPane(1, { terminalOf: () => 70, stateOf: () => "working", write });
    release();
    await stopped;
    await flush();
    expect(cancelled).toBe(1);
    expect(failed).toBe(0);
    expect(notes[notes.length - 1]).toBe(CANCELLED_NOTE);
  });
});
