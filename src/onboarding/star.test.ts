// ONB-037 and ONB-038 (T-322-b): the star prompt's rules. Every test uses fakes; nothing talks to GitHub.
import { describe, expect, it, vi } from "vitest";
import {
  completedState, COOLDOWN_MS, createStar, dismissed, emptyScreen, finishedTask, fresh, hidden, landingStar, onboardingToast, QUIET_MS, showing, stateOf, STAR_THRESHOLD,
  starAfterClose, STAR_EVENT, thresholdDue, withVersion, type Ctx, type StarState,
} from "./star";

const ok: Ctx = { now: 1_000_000, starred: false, window: true };
const base = (o: Partial<StarState> = {}): StarState => ({ ...fresh(), version: "1.0.0", ...o });

describe("when the card shows (ONB-037)", () => {
  it("shows after 35 launches since the baseline, not before", () => {
    expect(thresholdDue(base({ baseline: 10 }), 10 + STAR_THRESHOLD - 1, ok)).toBe(false);
    expect(thresholdDue(base({ baseline: 10 }), 10 + STAR_THRESHOLD, ok)).toBe(true);
  });
  it("each update takes a new baseline, unless the user already completed the prompt", () => {
    expect(withVersion(base({ baseline: 5 }), "1.1.0", 90)).toMatchObject({ version: "1.1.0", baseline: 90 });
    expect(withVersion(base({ baseline: 5 }), "1.0.0", 90).baseline).toBe(5);
    expect(withVersion(base({ baseline: 5, completed: true }), "1.1.0", 90)).toMatchObject({ version: "1.1.0", baseline: 5 });
  });
  it("never shows during a cooldown, after completion, once starred or with no window; a forced show skips only the cooldown", () => {
    const s = base({ cooldownUntil: ok.now + 1 });
    expect(thresholdDue(s, 99, ok)).toBe(false);
    expect(thresholdDue(s, 99, { ...ok, forced: true })).toBe(true);
    expect(thresholdDue(base({ completed: true }), 99, { ...ok, forced: true })).toBe(false);
    expect(thresholdDue(base(), 99, { ...ok, starred: true })).toBe(false);
    expect(thresholdDue(base(), 99, { ...ok, window: false, forced: true })).toBe(false);
    // a star state that could not be read does not hide the card
    expect(thresholdDue(base(), 99, { ...ok, starred: null })).toBe(true);
  });
  it("the onboarding-finished toast follows the same holds", () => {
    expect(onboardingToast(base(), ok)).toBe(true);
    expect(onboardingToast(base({ completed: true }), ok)).toBe(false);
    expect(onboardingToast(base({ cooldownUntil: ok.now + 5 }), ok)).toBe(false);
  });
});

describe("'Later' and Dismiss (ONB-037)", () => {
  it("start a three-day cooldown, double the threshold and take a new baseline: 70 more launches after that", () => {
    const sc = showing(emptyScreen(), "card");
    const r = dismissed(base(), sc, ok.now, 40);
    expect(r.state).toMatchObject({ cooldownUntil: ok.now + COOLDOWN_MS, threshold: 70, baseline: 40 });
    expect(r.screen.shown).toBeNull();
    const later = { now: ok.now + COOLDOWN_MS, starred: false, window: true };
    expect(thresholdDue(r.state, 40 + 69, later)).toBe(false);
    expect(thresholdDue(r.state, 40 + 70, later)).toBe(true);
    expect(thresholdDue(r.state, 40 + 70, ok)).toBe(false);
  });
  it("count only while a prompt is on screen, and once per prompt", () => {
    expect(dismissed(base(), emptyScreen(), ok.now, 40).state).toEqual(base());
    const sc = showing(emptyScreen(), "card");
    const once = dismissed(base(), sc, ok.now, 40);
    const twice = dismissed(once.state, { ...once.screen, shown: sc.shown }, ok.now + 5, 41);
    expect(twice.state).toEqual(once.state);
    // a new prompt can be dismissed again
    const again = dismissed(once.state, showing(once.screen, "card"), ok.now + 9, 50);
    expect(again.state.threshold).toBe(140);
  });
  it("replacing or hiding the toast is not a dismissal", () => {
    const sc = showing(emptyScreen(), "toast");
    const gone = hidden(sc);
    expect(gone.shown).toBeNull();
    expect(dismissed(base(), gone, ok.now, 40).state).toEqual(base());
  });
  it("the toast replaces a card, and a card never replaces a toast", () => {
    const card = showing(emptyScreen(), "card");
    expect(showing(card, "toast").shown?.kind).toBe("toast");
    const toast = showing(emptyScreen(), "toast");
    expect(showing(toast, "card")).toBe(toast);
  });
});

describe("the finished-task moment (ONB-037)", () => {
  const quiet = { clean: true, quietMs: QUIET_MS };
  it("fires once per app version", () => {
    const first = finishedTask(base(), "1.0.0", ok, quiet);
    expect(first.show).toBe(true);
    expect(finishedTask(first.state, "1.0.0", ok, quiet).show).toBe(false);
    expect(finishedTask(first.state, "1.1.0", ok, quiet).show).toBe(true);
  });
  it("waits for an uninterrupted session and about a second of quiet, without spending the moment", () => {
    expect(finishedTask(base(), "1.0.0", ok, { clean: false, quietMs: 5000 })).toEqual({ show: false, state: base() });
    expect(finishedTask(base(), "1.0.0", ok, { clean: true, quietMs: QUIET_MS - 1 })).toEqual({ show: false, state: base() });
  });
  it("during a cooldown it is spent for the version and does not show later in it", () => {
    const cooling = base({ cooldownUntil: ok.now + 10 });
    const r = finishedTask(cooling, "1.0.0", ok, quiet);
    expect(r.show).toBe(false);
    expect(r.state.taskSpent).toBe("1.0.0");
    expect(finishedTask(r.state, "1.0.0", { ...ok, now: ok.now + 20 }, quiet).show).toBe(false);
  });
  it("finding no window to show in does not spend it", () => {
    const r = finishedTask(base(), "1.0.0", { ...ok, window: false }, quiet);
    expect(r).toEqual({ show: false, state: base() });
    expect(finishedTask(r.state, "1.0.0", ok, quiet).show).toBe(true);
  });
  it("nothing after completion or a star", () => {
    expect(finishedTask(completedState(base()), "1.0.0", ok, quiet).show).toBe(false);
    expect(finishedTask(base(), "1.0.0", { ...ok, starred: true }, quiet).show).toBe(false);
  });
});

describe("the saved record", () => {
  it("reads damaged fields as their defaults", () => {
    expect(stateOf(null)).toEqual(fresh());
    expect(stateOf({ version: 3, baseline: -2, threshold: "x", cooldownUntil: NaN, completed: "yes", taskSpent: 7 })).toEqual(fresh());
    expect(stateOf({ version: "2", baseline: 4, threshold: 70, completed: true })).toMatchObject({ version: "2", baseline: 4, threshold: 70, completed: true });
  });
});

const flow = (o: { check?: () => Promise<boolean | null>; put?: () => Promise<void> } = {}) => {
  const io = { check: vi.fn(o.check ?? (async () => false)), put: vi.fn(o.put ?? (async () => {})) };
  const seen: string[] = [];
  return { io, seen, star: createStar(io, (u) => seen.push(u)) };
};

describe("starring and its states (ONB-038)", () => {
  it("busy, then the thank-you, only after the direct star worked", async () => {
    const f = flow();
    const p = f.star.click();
    expect(f.star.ui()).toBe("busy");
    expect(f.seen).toEqual(["busy"]);
    await p;
    expect(f.seen).toEqual(["busy", "thanks"]);
    expect(f.io.put).toHaveBeenCalledTimes(1);
  });
  it("nothing is starred before the click", () => {
    const f = flow();
    expect(f.io.put).not.toHaveBeenCalled();
    expect(f.io.check).not.toHaveBeenCalled();
    expect(f.star.ui()).toBe("idle");
  });
  it("a star state that cannot be checked offers the browser fallback and stars nothing", async () => {
    const a = flow({ check: async () => null });
    expect(await a.star.click()).toBe("fallback");
    expect(a.io.put).not.toHaveBeenCalled();
    const b = flow({ check: async () => { throw new Error("gh missing"); } });
    expect(await b.star.click()).toBe("fallback");
  });
  it("a failed direct star switches to the fallback, and the attempt can be tried again", async () => {
    let n = 0;
    const f = flow({ put: async () => { if (n++ === 0) throw new Error("401"); } });
    expect(await f.star.click()).toBe("fallback");
    expect(await f.star.click()).toBe("thanks");
    expect(f.io.put).toHaveBeenCalledTimes(2);
  });
  it("duplicate clicks while one is in flight are ignored, and Dismiss is off while busy", async () => {
    let release = () => {};
    const f = flow({ put: () => new Promise<void>((r) => (release = r)) });
    const first = f.star.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.star.canDismiss()).toBe(false);
    await f.star.click();
    release();
    await first;
    expect(f.io.put).toHaveBeenCalledTimes(1);
    expect(f.star.canDismiss()).toBe(true);
  });
  it("already starred reads as done without starring again", async () => {
    const f = flow({ check: async () => true });
    expect(await f.star.click()).toBe("thanks");
    expect(f.io.put).not.toHaveBeenCalled();
  });
  it("a prompt taken off screen while the star runs brings nothing back when it fails", async () => {
    let fail = () => {};
    const f = flow({ put: () => new Promise<void>((_, rej) => (fail = () => rej(new Error("boom")))) });
    const p = f.star.click();
    await Promise.resolve();
    await Promise.resolve();
    f.star.abandon();
    fail();
    await p;
    expect(f.seen).toEqual(["busy"]); // no fallback shown afterwards
    // and the prompt's cooldown is untouched by the failure
    const sc = showing(emptyScreen(), "card");
    const r = dismissed(base(), sc, ok.now, 40);
    expect(r.state.cooldownUntil).toBe(ok.now + COOLDOWN_MS);
  });
});

describe("the landing-screen star", () => {
  it("changes at once, before the answer", async () => {
    const seen: Array<{ starred: boolean; fallback: boolean }> = [];
    let release = () => {};
    const p = landingStar(() => new Promise<void>((r) => (release = r)), (s) => seen.push(s));
    expect(seen).toEqual([{ starred: true, fallback: false }]);
    release();
    await p;
    expect(seen).toHaveLength(1);
  });
  it("goes back and offers the fallback when the star fails", async () => {
    const seen: Array<{ starred: boolean; fallback: boolean }> = [];
    await landingStar(async () => { throw new Error("x"); }, (s) => seen.push(s));
    expect(seen[seen.length - 1]).toEqual({ starred: false, fallback: true });
  });
});

describe("the onboarding-finished hook (T-208-c)", () => {
  it("a completed close asks for the toast, a dismissed one does not", () => {
    const bus = new EventTarget();
    vi.stubGlobal("window", bus);
    const heard: unknown[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent).detail);
    bus.addEventListener(STAR_EVENT, on);
    starAfterClose("dismissed");
    expect(heard).toEqual([]);
    starAfterClose("completed");
    expect(heard).toEqual([{ kind: "onboarding-done" }]);
    vi.unstubAllGlobals();
  });
});
