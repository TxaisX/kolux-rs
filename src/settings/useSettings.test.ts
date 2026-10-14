import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { changes, Draft, DRAFT_PAUSE_MS, inOrder, inTurn, numberOrDefault } from "./useSettings";

const later = <T,>() => {
  let done!: (v: T) => void, fail!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => ((done = a), (fail = b)));
  return { p, done, fail };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("saves queued in quick succession apply in order (SET-036)", () => {
  it("starts each save only when the one before has settled, failed or not", async () => {
    const calls: string[] = [];
    const gates = [later<string>(), later<string>(), later<string>()];
    const run = inOrder((n: number) => (calls.push(`start ${n}`), gates[n].p));
    const a = run(0), b = run(1), c = run(2);
    await tick();
    expect(calls).toEqual(["start 0"]);
    gates[0].fail(new Error("disk full"));
    await expect(a).rejects.toThrow("disk full");
    await tick();
    expect(calls).toEqual(["start 0", "start 1"]);
    gates[1].done("one");
    gates[2].done("two");
    await expect(b).resolves.toBe("one");
    await expect(c).resolves.toBe("two");
    expect(calls).toEqual(["start 0", "start 1", "start 2"]);
  });
});

describe("text fields never lose what was typed (SET-036)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves after a short pause, once, with the last text", async () => {
    const saved: string[] = [];
    const d = new Draft("", (t) => void saved.push(t));
    d.type("h");
    d.type("ht");
    d.type("http://proxy");
    await vi.advanceTimersByTimeAsync(DRAFT_PAUSE_MS - 1);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(["http://proxy"]);
    await d.flush();
    expect(saved).toEqual(["http://proxy"]);
  });

  it("saves straight away on leaving the field, and the pause timer then does nothing", async () => {
    const saved: string[] = [];
    const d = new Draft("a", (t) => void saved.push(t));
    d.type("ab");
    await d.flush();
    expect(saved).toEqual(["ab"]);
    await vi.advanceTimersByTimeAsync(DRAFT_PAUSE_MS * 2);
    expect(saved).toEqual(["ab"]);
  });

  it("keeps a keystroke made while the save runs, and the stored value does not overwrite it", async () => {
    const gate = later<boolean>();
    const saved: string[] = [];
    const d = new Draft("", (t) => (saved.push(t), gate.p));
    d.type("ab");
    const first = d.flush();
    d.type("abc");
    gate.done(true);
    await first;
    expect(d.stored("ab")).toBe("abc");
    await d.flush();
    expect(saved).toEqual(["ab", "abc"]);
    expect(d.stored("abc")).toBe("abc");
    // with nothing typed since, a new stored value (another window) is shown
    expect(d.stored("from elsewhere")).toBe("from elsewhere");
  });

  it("keeps the text after a failed save and tries again on the next leave", async () => {
    let fail = true;
    const saved: string[] = [];
    const d = new Draft("old", async (t) => {
      saved.push(t);
      if (fail) throw new Error("no");
      return true;
    });
    d.type("new");
    await d.flush();
    expect(d.stored("old")).toBe("new");
    fail = false;
    await d.flush();
    expect(saved).toEqual(["new", "new"]);
    // a commit that reports false counts as failed too
    const e = new Draft("x", () => Promise.resolve(false));
    e.type("y");
    await e.flush();
    expect(e.stored("x")).toBe("y");
  });

  it("never saves half-way through an input-method composition", async () => {
    const saved: string[] = [];
    const d = new Draft("", (t) => void saved.push(t));
    d.compose(true);
    d.type("n");
    d.type("にほ");
    await vi.advanceTimersByTimeAsync(DRAFT_PAUSE_MS * 3);
    await d.flush();
    expect(saved).toEqual([]);
    d.type("日本");
    d.compose(false);
    await vi.advanceTimersByTimeAsync(DRAFT_PAUSE_MS);
    expect(saved).toEqual(["日本"]);
  });

  it("does not save text that matches the stored value", async () => {
    const saved: string[] = [];
    const d = new Draft("same", (t) => void saved.push(t));
    d.type("sam");
    d.type("same");
    await d.flush();
    expect(saved).toEqual([]);
  });
});

describe("a whole-settings change is sent as only what it changed (SET-035)", () => {
  it("names changed fields, nulls dropped ones and leaves the rest out", () => {
    const prev = { a: 1, b: { x: [1] }, c: "keep", gone: true };
    expect(changes(prev, { a: 2, b: { x: [1] }, c: "keep", added: "y" })).toEqual({ a: 2, gone: null, added: "y" });
    expect(changes(prev, prev)).toEqual({});
  });
});

describe("number fields that can be cleared go back to their default (SET-036)", () => {
  it("reads empty as the default and keeps a number in range", () => {
    expect(numberOrDefault("", 10, [0, 120])).toBe(10);
    expect(numberOrDefault("  ", 10, [0, 120])).toBe(10);
    expect(numberOrDefault("15", 10, [0, 120])).toBe(15);
    expect(numberOrDefault("500", 10, [0, 120])).toBe(120);
    expect(numberOrDefault("abc", 10, [0, 120])).toBe(10);
    expect(numberOrDefault("2.6", 10, [0, 120])).toBe(3);
  });
});

test("settings saves run one at a time, so a quick second save cannot drop the first", async () => {
  let disk: Record<string, unknown> = {};
  const tick = () => new Promise((r) => setTimeout(r, 5));
  // Read, wait, then write: two of these at once would lose a field.
  const save = inTurn(async (patch: Record<string, unknown>) => {
    const read = { ...disk };
    await tick();
    disk = { ...read, ...patch };
  });
  await Promise.all([save({ branchPrefixCustom: "feat" }), save({ refreshBaseFirst: true })]);
  expect(disk).toEqual({ branchPrefixCustom: "feat", refreshBaseFirst: true });
  // A failed save does not block the next one.
  const flaky = inTurn(async (fail: boolean) => {
    if (fail) throw new Error("no");
    return "ok";
  });
  await expect(flaky(true)).rejects.toThrow("no");
  await expect(flaky(false)).resolves.toBe("ok");
});
