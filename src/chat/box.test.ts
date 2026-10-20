// Council FIX-2 (re-review of chat 8151d6f, FS3 and FS5): the chat box's Enter as ChatView runs it
// (`boxSend`, with Tauri's own invoke and listen replaced by stand-ins), so a held send is said in
// the box and a failed one is marked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: { id: number; data: string }[] = [];
const handlers: ((e: { payload: unknown }) => void)[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { id: number; data: string }) => {
    if (cmd !== "terminal_write") throw new Error(`unexpected ${cmd}`);
    if (args.data.includes("boom")) throw new Error("the terminal is gone");
    writes.push(args);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, h: (e: { payload: unknown }) => void) => {
    handlers.push(h);
    return () => {};
  },
}));
import { listen } from "@tauri-apps/api/event";
import { ASKING_NOTE } from "./composer";
import { NO_TERMINAL_NOTE, STOPPED_NOTE, TOO_LONG_NOTE, UNSEEN_NOTE, boxSend, forgetHearing, hearStates, setClock, writeTerminal } from "./send";
import { LIMIT } from "../terminal/paste";

const emit = (p: unknown) => handlers.forEach((h) => h({ payload: p }));
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function ui() {
  const notes: (string | null)[] = [];
  let queued = 0;
  let failed = 0;
  return {
    notes,
    counts: () => ({ queued, failed }),
    hooks: { note: (n: string | null) => notes.push(n), onQueued: () => void queued++, onFailed: () => void failed++ },
  };
}

beforeEach(async () => {
  writes.length = 0;
  handlers.length = 0;
  setClock(() => 0);
  await hearStates(listen as never);
});
afterEach(() => forgetHearing());

const deps = (state: string | undefined, terminal: number | null = 70) => ({ terminalOf: () => terminal ?? undefined, stateOf: () => state, write: writeTerminal, sleep: async () => {} });

describe("the chat box's Enter (boxSend, the function ChatView.send runs)", () => {
  it("held: nothing is typed, the box keeps the text, and it says why", () => {
    const u = ui();
    expect(boxSend(7, "claude", "go on", deps("permission"), u.hooks)).toBe(false);
    expect(u.notes).toEqual([ASKING_NOTE]);
    expect(u.counts().queued).toBe(0);
    expect(writes).toEqual([]);
  });

  it("held by an old reading the chat heard (a card deny the window already counted): it says why", () => {
    emit({ paneKey: 7, state: "permission", terminal: 70 });
    const u = ui();
    expect(boxSend(7, "claude", "go on", deps("working"), u.hooks)).toBe(false);
    expect(u.notes).toEqual([ASKING_NOTE]);
  });

  it("no hook reading, no terminal, too long: each says so", () => {
    const u = ui();
    expect(boxSend(7, "claude", "go on", deps(undefined), u.hooks)).toBe(false);
    expect(boxSend(7, "claude", "go on", deps("idle", null), u.hooks)).toBe(false);
    expect(boxSend(7, "claude", "x".repeat(LIMIT + 1), deps("idle"), u.hooks)).toBe(false);
    expect(u.notes).toEqual([UNSEEN_NOTE, NO_TERMINAL_NOTE, TOO_LONG_NOTE]);
  });

  it("clear: the message goes into the terminal through invoke, with its Enter", async () => {
    const u = ui();
    expect(boxSend(7, "claude", "hello", deps("idle"), u.hooks)).toBe(true);
    await flush();
    expect(writes.map((w) => w.data)).toEqual(["\x15", "\x1b[200~hello\x1b[201~", "\r"]);
    expect(writes.every((w) => w.id === 70)).toBe(true);
    expect(u.counts()).toEqual({ queued: 1, failed: 0 });
  });

  it("a menu that opens mid-send marks the message failed and says the send stopped", async () => {
    let state = "working";
    const u = ui();
    const d = { ...deps("working"), stateOf: () => state, write: async (id: number, data: string) => {
      await writeTerminal(id, data);
      if (data.includes("hello")) state = "permission";
    } };
    expect(boxSend(7, "claude", "hello", d, u.hooks)).toBe(true);
    await flush();
    expect(writes.map((w) => w.data)).not.toContain("\r");
    expect(u.counts()).toEqual({ queued: 1, failed: 1 });
    expect(u.notes[u.notes.length - 1]).toBe(`${STOPPED_NOTE} ${ASKING_NOTE}`);
  });

  it("a terminal write that fails marks the message failed", async () => {
    const u = ui();
    expect(boxSend(7, "claude", "boom", deps("idle"), u.hooks)).toBe(true);
    await flush();
    expect(u.counts().failed).toBe(1);
  });
});
