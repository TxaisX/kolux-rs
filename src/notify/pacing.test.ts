import { expect, test } from "vitest";
import { COOLDOWN_MS, MAX_TRACKED, decide, emptyPacer, eventId, paneFor, type NotifyEvent } from "./pacing";

const ev = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({ id: "a:1", worktree: "C:/w/a", pane: "p1", kind: "finish", at: 1000, ...over });
const quiet = { windowFocused: false, suppressFocused: true };

test("stat044 two completions from one worktree inside the cooldown are one notification", () => {
  let s = emptyPacer();
  let r = decide(s, ev(), quiet);
  expect(r.show).toBe(true);
  s = r.state;
  r = decide(s, ev({ id: "a:2", at: 1000 + COOLDOWN_MS - 1 }), quiet);
  expect(r.show).toBe(false);
  expect(r.reason).toBe("cooldown");
  // once the cooldown has passed the next one shows
  r = decide(r.state, ev({ id: "a:3", at: 1000 + COOLDOWN_MS }), quiet);
  expect(r.show).toBe(true);
});

test("stat044 a task-complete and a terminal bell for the same event merge", () => {
  const s = decide(emptyPacer(), ev({ kind: "finish" }), quiet).state;
  const r = decide(s, ev({ id: "a:bell", kind: "bell", at: 1200 }), quiet);
  expect(r.show).toBe(false);
  expect(r.reason).toBe("cooldown");
});

test("stat044 another worktree is not held back by the first one's cooldown", () => {
  const s = decide(emptyPacer(), ev(), quiet).state;
  const r = decide(s, ev({ id: "b:1", worktree: "C:/w/b", pane: "p2", at: 1001 }), quiet);
  expect(r.show).toBe(true);
});

test("stat044 the same event id never shows twice, even after the cooldown", () => {
  const s = decide(emptyPacer(), ev(), quiet).state;
  const r = decide(s, ev({ at: 1000 + COOLDOWN_MS * 10 }), quiet);
  expect(r.show).toBe(false);
  expect(r.reason).toBe("duplicate");
});

test("stat044 test notifications ignore the cooldown and the id memory", () => {
  const s = decide(emptyPacer(), ev(), quiet).state;
  const t = ev({ id: "test", kind: "test", at: 1001 });
  expect(decide(s, t, quiet).show).toBe(true);
  expect(decide(decide(s, t, quiet).state, t, quiet).show).toBe(true);
});

test("stat044 the worktree in view stays quiet while the window has focus if that option is on", () => {
  const looking = { windowFocused: true, suppressFocused: true, focusedWorktree: "C:/w/a" };
  const r = decide(emptyPacer(), ev(), looking);
  expect(r.show).toBe(false);
  expect(r.reason).toBe("focused");
  // with the option off a focused window still gets it
  expect(decide(emptyPacer(), ev(), { ...looking, suppressFocused: false }).show).toBe(true);
  // a held-back event still counts as seen, so it never comes back later as a duplicate
  expect(decide(r.state, ev({ at: 9000 }), quiet).reason).toBe("duplicate");
});

test("stat044 the memory stays bounded during a burst", () => {
  let s = emptyPacer();
  for (let i = 0; i < MAX_TRACKED * 3; i++) {
    s = decide(s, ev({ id: `w${i}:1`, worktree: `C:/w/${i}`, pane: `p${i}`, at: 1000 + i }), quiet).state;
  }
  expect(s.seen.length).toBeLessThanOrEqual(MAX_TRACKED);
  expect(s.last.length).toBeLessThanOrEqual(MAX_TRACKED);
  expect(s.targets.length).toBeLessThanOrEqual(MAX_TRACKED);
  // the newest are the ones kept
  expect(paneFor(s, `w${MAX_TRACKED * 3 - 1}:1`)).toBe(`p${MAX_TRACKED * 3 - 1}`);
  expect(paneFor(s, "w0:1")).toBeNull();
});

test("stat044 clicking a notification finds the pane that raised it", () => {
  const s = decide(emptyPacer(), ev({ id: "a:1", pane: "p7" }), quiet).state;
  expect(paneFor(s, "a:1")).toBe("p7");
  expect(paneFor(s, "nope")).toBeNull();
});

test("stat044 an event without a worktree is paced on its own and never merged with others", () => {
  const s = decide(emptyPacer(), ev({ worktree: null }), quiet).state;
  expect(decide(s, ev({ id: "x", worktree: null, at: 1001 }), quiet).show).toBe(true);
});

test("stat044 fix-1: two finishes 30 s apart inside one clock minute both notify; a repeat inside the cooldown is merged", () => {
  // 1_700_000_040_000 is a minute boundary: +1 s and +31 s sit in the same minute.
  const t0 = 1_700_000_041_000;
  const first = eventId("7", "finished its task", t0);
  const second = eventId("7", "finished its task", t0 + 30_000);
  expect(first).not.toBe(second);
  let r = decide(emptyPacer(), ev({ id: first, at: t0 }), quiet);
  expect(r.show).toBe(true);
  r = decide(r.state, ev({ id: second, at: t0 + 30_000 }), quiet);
  expect(r.show).toBe(true);
  // the same pane reporting again 2 s later is one event with the second
  r = decide(r.state, ev({ id: eventId("7", "finished its task", t0 + 32_000), at: t0 + 32_000 }), quiet);
  expect(r.show).toBe(false);
  expect(r.reason).toBe("cooldown");
});

test("stat044 fix-1: while Kolux has focus only the worktree being looked at stays quiet; another worktree's finish still notifies", () => {
  const opts = { windowFocused: true, suppressFocused: true, focusedWorktree: "C:/w/a" };
  const other = decide(emptyPacer(), ev({ worktree: "C:/w/b", pane: "p2" }), opts);
  expect(other.show).toBe(true);
  // the looked-at worktree, in any spelling, is the one kept quiet
  const same = decide(emptyPacer(), ev({ worktree: "c:\\w\\a\\" }), opts);
  expect(same.show).toBe(false);
  expect(same.reason).toBe("focused");
  // with the window unfocused the looked-at worktree notifies too
  expect(decide(emptyPacer(), ev(), { ...opts, windowFocused: false }).show).toBe(true);
  // no worktree in view (a settings page): nothing is kept quiet
  expect(decide(emptyPacer(), ev(), { ...opts, focusedWorktree: null }).show).toBe(true);
  // an event without a worktree is never "the one being looked at"
  expect(decide(emptyPacer(), ev({ worktree: null }), opts).show).toBe(true);
});
