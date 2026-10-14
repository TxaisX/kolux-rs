import { expect, test } from "vitest";
import { mergePoll, nextDelay, POLL_MS, pollItems, rowPr } from "./poll";

test("GIT-027: the visible workspace is looked up first, each once, a hand link in place of its branch", () => {
  const items = pollItems(["G:/a", "G:/b", "G:/c", "G:/b"], "G:/c", { "G:/a": "https://github.com/o/r/pull/2" });
  expect(items).toEqual([{ path: "G:/c", linked: null }, { path: "G:/a", linked: "https://github.com/o/r/pull/2" }, { path: "G:/b", linked: null }]);
});

test("GIT-027: a row's pull request state, and a failed lookup keeps what was known", () => {
  const pr = (state: string, draft = false) => ({ number: 1, url: "u", state, draft });
  expect([rowPr(pr("OPEN")), rowPr(pr("OPEN", true)), rowPr(pr("MERGED")), rowPr(pr("CLOSED")), rowPr(null)]).toEqual(["open", "draft", "merged", "closed", null]);
  const prev = { "G:/a": "open" as const, "G:/b": "open" as const };
  const next = mergePoll(prev, { prs: [{ path: "G:/a", linked: false, pr: pr("MERGED"), error: null }, { path: "G:/b", linked: false, pr: null, error: "rate limit" }, { path: "G:/c", linked: false, pr: null, error: null }], limitedUntil: null });
  expect(next).toEqual({ "G:/a": "merged", "G:/b": "open", "G:/c": null });
});

test("GIT-027 / GIT-028: failures back off to half an hour, and a rate limit waits for its reset", () => {
  const now = 1_000_000;
  expect(nextDelay(0, null, now)).toBe(POLL_MS);
  expect(nextDelay(1, null, now)).toBe(POLL_MS * 2);
  expect(nextDelay(9, null, now)).toBe(30 * 60_000);
  expect(nextDelay(0, (now + 600_000) / 1000, now)).toBe(605_000);
  // A reset already past does not stall the poll.
  expect(nextDelay(0, (now - 5000) / 1000, now)).toBe(POLL_MS);
});
