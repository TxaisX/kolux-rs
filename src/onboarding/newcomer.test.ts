import { describe, expect, it, vi } from "vitest";
import { ALL_DONE, allDoneToast, checklistOf, ITEMS, type FirstRun } from "./newcomer";

const finished = (milestones: FirstRun["milestones"] = {}, more: Partial<FirstRun> = {}): FirstRun => ({ closed: true, outcome: "completed", checklistDismissed: false, milestones, ...more });
const all = { aiConnected: 1 };

describe("newcomer checklist (ONB-013)", () => {
  it("a new profile that finished onboarding sees the one item, nothing ticked, pointing at Connect an AI", () => {
    const c = checklistOf(finished(), []);
    expect(ITEMS.map((i) => i.label)).toEqual(["Connect an AI"]);
    expect([c.show, c.ready, c.ticked.size, c.next, c.done]).toEqual([true, true, 0, "connect", false]);
  });

  it("with the item ticked: done, and there is no next item", () => {
    const c = checklistOf(finished(all), []);
    expect([c.next, c.done, c.ticked.size]).toEqual([null, true, 1]);
  });

  it("not read yet is not ready and never done; an older profile with no record and a dismissed or open one are not shown", () => {
    expect([checklistOf(undefined, []).ready, checklistOf(undefined, []).done, checklistOf(undefined, []).show]).toEqual([false, false, false]);
    expect([checklistOf(null, []).show, checklistOf(null, []).done]).toEqual([false, false]);
    expect(checklistOf(finished({}, { checklistDismissed: true }), []).show).toBe(false);
    expect(checklistOf(finished({}, { closed: false, outcome: null }), []).show).toBe(false);
  });

  it("the all-done toast fires once per profile and never on a redraw", () => {
    const mark = vi.fn(() => Promise.resolve());
    const toast = allDoneToast(mark);
    const done = checklistOf(finished(all), []);
    expect(toast(checklistOf(finished(), []), [])).toBe(false);
    expect(toast(done, [])).toBe(true);
    expect(toast(done, [])).toBe(false);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(ALL_DONE);
    expect(allDoneToast(mark)(done, [ALL_DONE])).toBe(false);
  });

  it("a dismissed checklist that is all done never toasts and marks nothing (FIX-1)", () => {
    const mark = vi.fn(() => Promise.resolve());
    const gone = checklistOf(finished(all, { checklistDismissed: true }), []);
    expect([gone.done, gone.show]).toEqual([true, false]);
    expect(allDoneToast(mark)(gone, [])).toBe(false);
    expect(mark).not.toHaveBeenCalled();
  });

  it("a failed toast mark stays silent", () => {
    const fail = () => Promise.reject(new Error("disk"));
    expect(allDoneToast(fail)(checklistOf(finished(all), []), [])).toBe(true);
  });
});
