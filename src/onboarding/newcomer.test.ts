import { describe, expect, it, vi } from "vitest";
import { ALL_DONE, allDoneToast, checklistOf, ITEMS, OWN_FILE, ranOnOwnFile, type FirstRun } from "./newcomer";

const finished = (milestones: FirstRun["milestones"] = {}, more: Partial<FirstRun> = {}): FirstRun => ({ closed: true, outcome: "completed", checklistDismissed: false, milestones, ...more });
const all = { aiConnected: 1, kitLaunched: 2, resultsOpened: 3 };

describe("newcomer checklist (ONB-013)", () => {
  it("a new profile that finished onboarding sees the four items, nothing ticked, pointing at Connect an AI", () => {
    const c = checklistOf(finished(), []);
    expect(ITEMS.map((i) => i.label)).toEqual(["Connect an AI", "Run a kit", "Open your results", "Run it on your own file"]);
    expect([c.show, c.ready, c.ticked.size, c.next, c.done]).toEqual([true, true, 0, "connect", false]);
  });

  it("with the first two items ticked the checklist points at open results", () => {
    expect(checklistOf(finished({ aiConnected: 5, kitLaunched: 9 }), []).next).toBe("results");
  });

  it("points at the first unticked item in the fixed order, even when a later one is ticked", () => {
    expect(checklistOf(finished({ kitLaunched: 9, resultsOpened: 10 }), [OWN_FILE]).next).toBe("connect");
  });

  it("all four ticked: done, and there is no next item", () => {
    const c = checklistOf(finished(all), [OWN_FILE]);
    expect([c.next, c.done, c.ticked.size]).toEqual([null, true, 4]);
    expect(checklistOf(finished(all), []).next).toBe("ownFile");
  });

  it("not read yet is not ready and never done; an older profile with no record and a dismissed or open one are not shown", () => {
    expect([checklistOf(undefined, [OWN_FILE]).ready, checklistOf(undefined, [OWN_FILE]).done, checklistOf(undefined, []).show]).toEqual([false, false, false]);
    expect([checklistOf(null, [OWN_FILE]).show, checklistOf(null, [OWN_FILE]).done]).toEqual([false, false]);
    expect(checklistOf(finished({}, { checklistDismissed: true }), []).show).toBe(false);
    expect(checklistOf(finished({}, { closed: false, outcome: null }), []).show).toBe(false);
  });

  it("the all-done toast fires once per profile and never on a redraw", () => {
    const mark = vi.fn(() => Promise.resolve());
    const toast = allDoneToast(mark);
    const done = checklistOf(finished(all), [OWN_FILE]);
    expect(toast(checklistOf(finished(all), []), [])).toBe(false);
    expect(toast(done, [OWN_FILE])).toBe(true);
    expect(toast(done, [OWN_FILE])).toBe(false);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(ALL_DONE);
    expect(allDoneToast(mark)(done, [OWN_FILE, ALL_DONE])).toBe(false);
  });

  it("a dismissed checklist that is all done never toasts and marks nothing (FIX-1)", () => {
    const mark = vi.fn(() => Promise.resolve());
    const gone = checklistOf(finished(all, { checklistDismissed: true }), [OWN_FILE]);
    expect([gone.done, gone.show]).toEqual([true, false]);
    expect(allDoneToast(mark)(gone, [OWN_FILE])).toBe(false);
    expect(mark).not.toHaveBeenCalled();
  });

  it("a failed toast mark or own-file mark stays silent", async () => {
    const fail = () => Promise.reject(new Error("disk"));
    expect(allDoneToast(fail)(checklistOf(finished(all), [OWN_FILE]), [OWN_FILE])).toBe(true);
    await expect(ranOnOwnFile(fail)).resolves.toBeUndefined();
    const ok = vi.fn(() => Promise.resolve());
    await ranOnOwnFile(ok);
    expect(ok).toHaveBeenCalledWith(OWN_FILE);
  });
});
