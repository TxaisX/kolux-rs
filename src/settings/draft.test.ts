import { expect, test } from "vitest";
import { createDraft } from "./draft";

/** A timer the test steps by hand. */
function clock() {
  let n = 0;
  const jobs = new Map<number, () => void>();
  return {
    timer: { set: (fn: () => void) => (jobs.set(++n, fn), n), clear: (t: unknown) => void jobs.delete(t as number) },
    pending: () => jobs.size,
    fire() {
      const all = [...jobs.values()];
      jobs.clear();
      all.forEach((f) => f());
    },
  };
}
const gate = () => {
  let open!: () => void;
  let fail!: (e: Error) => void;
  const p = new Promise<void>((res, rej) => ((open = res), (fail = rej)));
  return { p, open, fail };
};
const flushMicro = () => new Promise((r) => setTimeout(r, 0));

test("SET-036: the text saves after a short pause, and typing again restarts the pause", async () => {
  const c = clock();
  const saved: string[] = [];
  const d = createDraft("", { save: async (t) => void saved.push(t), timer: c.timer });
  d.type("1");
  d.type("10");
  expect(c.pending()).toBe(1);
  expect(saved).toEqual([]);
  c.fire();
  await flushMicro();
  expect(saved).toEqual(["10"]);
  expect(d.state().dirty).toBe(false);
});

test("SET-036: leaving the field saves at once, no waiting for the pause", async () => {
  const c = clock();
  const saved: string[] = [];
  const d = createDraft("", { save: async (t) => void saved.push(t), timer: c.timer });
  d.type("proxy.example:8080");
  await d.leave();
  expect(saved).toEqual(["proxy.example:8080"]);
  expect(c.pending()).toBe(0);
});

test("SET-036: a keystroke made while the previous save runs is kept, and saves queue in order", async () => {
  const c = clock();
  const saved: string[] = [];
  const g = gate();
  let first = true;
  const d = createDraft("", {
    save: async (t) => {
      saved.push(t);
      if (first) {
        first = false;
        await g.p;
      }
    },
    timer: c.timer,
  });
  d.type("a");
  const leaving = d.leave();
  await flushMicro();
  expect(d.state().saving).toBe(true);
  d.type("ab"); // typed during the save
  d.type("abc");
  g.open();
  await leaving;
  expect(saved).toEqual(["a", "abc"]);
  expect(d.state()).toMatchObject({ text: "abc", saved: "abc", dirty: false, saving: false });
});

test("SET-036: a failed save keeps the typed text for another try", async () => {
  const c = clock();
  let fail = true;
  const saved: string[] = [];
  const d = createDraft("old", {
    save: async (t) => {
      if (fail) throw new Error("disk full");
      saved.push(t);
    },
    timer: c.timer,
  });
  d.type("new text");
  await d.leave();
  expect(d.state()).toMatchObject({ text: "new text", saved: "old", dirty: true, error: "disk full" });
  fail = false;
  await d.leave();
  expect(saved).toEqual(["new text"]);
  expect(d.state()).toMatchObject({ saved: "new text", error: null });
});

test("SET-036: input-method composition is never saved half-way", async () => {
  const c = clock();
  const saved: string[] = [];
  const d = createDraft("", { save: async (t) => void saved.push(t), timer: c.timer });
  d.compositionStart();
  d.type("に");
  d.type("にほ");
  expect(c.pending()).toBe(0); // no save is even scheduled while composing
  c.fire();
  await flushMicro();
  expect(saved).toEqual([]);
  d.compositionEnd("日本");
  expect(c.pending()).toBe(1);
  c.fire();
  await flushMicro();
  expect(saved).toEqual(["日本"]);
});

test("SET-036: leaving the field mid-composition saves what the field then holds", async () => {
  const saved: string[] = [];
  const d = createDraft("", { save: async (t) => void saved.push(t), timer: clock().timer });
  d.compositionStart();
  d.type("かな");
  await d.leave(); // focus loss ends the composition in the browser
  expect(saved).toEqual(["かな"]);
});

test("SET-036: an update from outside does not overwrite what is being typed, but does reach an idle field", async () => {
  const c = clock();
  const d = createDraft("one", { save: async () => {}, timer: c.timer });
  expect(d.outside("two")).toBe(true);
  expect(d.state().text).toBe("two");
  d.type("two and typing");
  expect(d.outside("three")).toBe(false);
  expect(d.state().text).toBe("two and typing");
  await d.leave();
  expect(d.outside("three")).toBe(true); // saved and idle again: the outside value is taken
  expect(d.state().text).toBe("three");
});

test("SET-036: an outside update during a save is ignored too, then the saved text stands", async () => {
  const c = clock();
  const g = gate();
  const d = createDraft("", { save: () => g.p, timer: c.timer });
  d.type("mine");
  const leaving = d.leave();
  await flushMicro();
  expect(d.outside("theirs")).toBe(false);
  g.open();
  await leaving;
  expect(d.state().text).toBe("mine");
});

test("SET-036: closing the window flushes the pending text; Escape puts the stored text back", async () => {
  const c = clock();
  const saved: string[] = [];
  const d = createDraft("kept", { save: async (t) => void saved.push(t), timer: c.timer });
  d.type("typed just now");
  await d.flush();
  expect(saved).toEqual(["typed just now"]);
  d.type("oops");
  d.discard();
  expect(d.state()).toMatchObject({ text: "typed just now", dirty: false });
  expect(c.pending()).toBe(0);
});
