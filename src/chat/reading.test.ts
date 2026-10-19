// T-330 (CHAT-009): hidden chats pause reading and keep their last good view.
import { beforeEach, describe, expect, it } from "vitest";
import { draftOf, keepDraft } from "./composer";
import type { ChatItem, ChatRead } from "./model";
import { ChatReader, NOTHING, forgetAllKept, keptFor, takeRead, type Seen, type Timers } from "./reading";

const item = (id: string, text = id): ChatItem => ({ id, role: "assistant", kind: "text", text });
const ready = (items: ChatItem[], extra: Partial<ChatRead> = {}): ChatRead => ({ state: "ready", reset: false, items, open: false, retryMs: 1000, ...extra });
const ids = (s: Seen) => s.items.map((i) => i.id);

/** A clock the test turns by hand and a transcript that answers when the test says so. */
function rig(pane = 1, session: number | undefined = 10, hidden = false) {
  const timers = new Set<number>();
  const due: Record<number, { f: () => void; ms: number }> = {};
  let next = 1;
  const clock: Timers = {
    set: (f, ms) => {
      const id = next++;
      timers.add(id);
      due[id] = { f, ms };
      return id;
    },
    clear: (t) => void timers.delete(t as number),
  };
  const reads: { ok: (r: ChatRead) => void; fail: (e: unknown) => void }[] = [];
  const log = { closes: 0, seen: [] as Seen[] };
  const reader = new ChatReader({
    pane,
    session,
    hidden,
    read: () => new Promise<ChatRead>((ok, fail) => reads.push({ ok, fail })),
    close: () => void log.closes++,
    onChange: (s) => log.seen.push(s),
    timers: clock,
  });
  /** Runs the retry timers that are still pending. */
  const tick = () => {
    for (const id of [...timers]) {
      timers.delete(id);
      due[id].f();
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { reader, reads, timers, log, tick, settle };
}

beforeEach(() => forgetAllKept());

describe("a chat that begins hidden (CHAT-009)", () => {
  it("reads nothing and sets no retry timer", () => {
    const t = rig(1, 10, true);
    expect(t.reads).toHaveLength(0);
    expect(t.timers.size).toBe(0);
    expect(t.reader.seen).toEqual(NOTHING);
  });
  it("starts its one read when it is shown", () => {
    const t = rig(1, 10, true);
    t.reader.show();
    t.reader.show();
    expect(t.reads).toHaveLength(1);
  });
});

describe("hiding a chat", () => {
  it("stops reading, cancels the pending retry and lets go of the transcript", async () => {
    const t = rig();
    expect(t.reads).toHaveLength(1);
    t.reads[0].ok(ready([item("a")]));
    await t.settle();
    expect(t.timers.size).toBe(1);
    t.reader.hide();
    expect(t.timers.size).toBe(0);
    expect(t.log.closes).toBe(1);
    t.tick();
    expect(t.reads).toHaveLength(1);
  });
  it("ignores a read that was still out when it was hidden", async () => {
    const t = rig();
    t.reader.hide();
    t.reads[0].ok(ready([item("late")]));
    await t.settle();
    expect(t.reader.seen.items).toEqual([]);
    expect(t.timers.size).toBe(0);
  });
  it("keeps polling on the retry the transcript asked for while shown", async () => {
    const t = rig();
    t.reads[0].ok(ready([item("a")], { retryMs: 750 }));
    await t.settle();
    t.tick();
    expect(t.reads).toHaveLength(2);
  });
});

describe("showing it again (CHAT-009 acceptance 1: no repeats)", () => {
  it("opens on the kept view at once and starts exactly one new read", async () => {
    const a = rig();
    a.reads[0].ok(ready([item("a"), item("b")], { reset: true }));
    await a.settle();
    a.reader.hide();
    const b = rig();
    expect(ids(b.reader.seen)).toEqual(["a", "b"]);
    expect(b.reads).toHaveLength(1);
  });
  it("replaces what was stale with the first snapshot, even a partial one, so nothing repeats", async () => {
    const a = rig();
    a.reads[0].ok(ready([item("old"), item("a")], { reset: true }));
    await a.settle();
    a.reader.hide();
    const b = rig();
    b.reads[0].ok(ready([item("a"), item("c")]));
    await b.settle();
    expect(ids(b.reader.seen)).toEqual(["a", "c"]);
    b.tick();
    b.reads[1].ok(ready([item("d")]));
    await b.settle();
    expect(ids(b.reader.seen)).toEqual(["a", "c", "d"]);
  });
  it("shows the same pane's turns that arrived while it was hidden", async () => {
    const a = rig();
    a.reads[0].ok(ready([item("t1")], { reset: true }));
    await a.settle();
    a.reader.hide();
    a.reader.show();
    expect(a.reads).toHaveLength(2);
    a.reads[1].ok(ready([item("t1"), item("t2"), item("t3")], { reset: true }));
    await a.settle();
    expect(ids(a.reader.seen)).toEqual(["t1", "t2", "t3"]);
    expect(a.log.closes).toBe(1);
  });
  it("keeps the stale view while the first read has nothing readable yet", async () => {
    const a = rig();
    a.reads[0].ok(ready([item("a")], { reset: true }));
    await a.settle();
    a.reader.hide();
    a.reader.show();
    a.reads[1].ok({ state: "loading", reset: false, items: [], open: false, retryMs: 500 });
    await a.settle();
    expect(ids(a.reader.seen)).toEqual(["a"]);
    expect(a.reader.seen.state).toBe("ready");
  });
});

describe("kept messages and the session behind the pane", () => {
  it("are thrown away when the pane's terminal changed while hidden", async () => {
    const a = rig(1, 10);
    a.reads[0].ok(ready([item("a")], { reset: true }));
    await a.settle();
    a.reader.hide();
    expect(keptFor(1, 10)?.items).toHaveLength(1);
    const b = rig(1, 11);
    expect(b.reader.seen).toEqual(NOTHING);
    expect(keptFor(1, 10)).toBeNull();
  });
  it("are kept per pane", async () => {
    const a = rig(1, 10);
    a.reads[0].ok(ready([item("a")], { reset: true }));
    await a.settle();
    const other = rig(2, 10);
    expect(other.reader.seen).toEqual(NOTHING);
    expect(ids(rig(1, 10).reader.seen)).toEqual(["a"]);
  });
  it("survive when neither visit knew the terminal", async () => {
    const a = rig(3, undefined);
    a.reads[0].ok(ready([item("a")], { reset: true }));
    await a.settle();
    a.reader.hide();
    expect(ids(rig(3, undefined).reader.seen)).toEqual(["a"]);
  });
});

describe("a read that fails after messages were shown (CHAT-009 acceptance 3)", () => {
  it("leaves the messages and no error when the transcript breaks", async () => {
    const t = rig();
    t.reads[0].ok(ready([item("a")], { reset: true }));
    await t.settle();
    t.tick();
    t.reads[1].ok({ state: "error", reset: false, items: [], open: false, error: "could not be found", retryMs: 3000 });
    await t.settle();
    expect(ids(t.reader.seen)).toEqual(["a"]);
    expect(t.reader.seen.state).toBe("ready");
    expect(t.reader.seen.error).toBeNull();
    expect(t.timers.size).toBe(1);
  });
  it("leaves the messages when the call itself is rejected, and retries", async () => {
    const t = rig();
    t.reads[0].ok(ready([item("a")], { reset: true }));
    await t.settle();
    t.tick();
    t.reads[1].fail("lost");
    await t.settle();
    expect(ids(t.reader.seen)).toEqual(["a"]);
    expect(t.reader.seen.error).toBeNull();
    expect(t.timers.size).toBe(1);
    t.tick();
    expect(t.reads).toHaveLength(3);
  });
  it("shows the error only when nothing was kept", async () => {
    const t = rig();
    t.reads[0].fail("no transcript");
    await t.settle();
    expect(t.reader.seen.state).toBe("error");
    expect(t.reader.seen.error).toBe("no transcript");
  });
  it("shows the transcript's own error text when nothing was kept", () => {
    const seen = takeRead(NOTHING, { state: "error", reset: false, items: [], open: false, error: "gone", retryMs: 10 }, true);
    expect(seen).toMatchObject({ state: "error", error: "gone" });
  });
  it("recovers: the next good read clears the state", async () => {
    const t = rig();
    t.reads[0].fail("x");
    await t.settle();
    t.tick();
    t.reads[1].ok(ready([item("a")]));
    await t.settle();
    expect(t.reader.seen).toMatchObject({ state: "ready", error: null });
  });
});

describe("the message box across a dropped terminal (CHAT-009 acceptance 2)", () => {
  it("keeps the draft when the terminal connection is dropped and restored", async () => {
    keepDraft(5, "half a sentence");
    const a = rig(5, 20);
    a.reads[0].ok(ready([item("a")], { reset: true }));
    await a.settle();
    a.reader.hide();
    const b = rig(5, 21); // the terminal came back as a new session
    expect(b.reader.seen).toEqual(NOTHING);
    expect(draftOf(5)).toBe("half a sentence");
  });
});
