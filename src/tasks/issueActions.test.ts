import { describe, expect, it } from "vitest";
import { actionError, runAction } from "./issueActions";

const later = () => {
  let done!: () => void;
  const p = new Promise<void>((r) => (done = r));
  return { p, done };
};

describe("FIX-1 issue actions (council FS 2)", () => {
  it("stays busy until the refreshed issue has come back, so Close cannot be sent twice", async () => {
    const busy: boolean[] = [];
    const refresh = later();
    let after = 0;
    const run = runAction({ send: Promise.resolve(), refresh: () => refresh.p, after: () => after++, setBusy: (b) => busy.push(b), setError: () => {}, what: "close" });
    await Promise.resolve();
    await Promise.resolve();
    expect(busy).toEqual([true]);
    expect(after).toBe(1);
    refresh.done();
    await run;
    expect(busy).toEqual([true, false]);
  });

  it("a gh timeout on a comment says it may have been posted, and nothing is refreshed", async () => {
    const errors: (string | null)[] = [];
    let refreshed = false;
    const busy: boolean[] = [];
    await runAction({ send: Promise.reject("github.com: gh did not answer within 30 seconds; try again in a moment"), refresh: async () => void (refreshed = true), setBusy: (b) => busy.push(b), setError: (e) => errors.push(e), what: "comment" });
    expect(errors[errors.length - 1]).toMatch(/may have been posted.*refresh/i);
    expect(refreshed).toBe(false);
    expect(busy).toEqual([true, false]);
  });

  it("other failures read as gh said them", () => {
    expect(actionError("There is no issue #9 in acme/app.", "close")).toBe("There is no issue #9 in acme/app.");
    expect(actionError("gh did not answer within 30 seconds; try again in a moment", "close")).toMatch(/may have been closed/);
    expect(actionError("gh did not answer within 30 seconds; try again in a moment", "reopen")).toMatch(/may have been reopened/);
    // FIX-2 AFTER 1: there is no issue to refresh yet after a create timeout, so it names the list.
    expect(actionError("gh did not answer within 30 seconds; try again in a moment", "create")).toBe("gh did not answer in time, so the issue may have been opened; refresh the list before trying again.");
    expect(actionError("gh did not answer within 30 seconds; try again in a moment", "close")).toMatch(/refresh the issue before/);
  });
});
