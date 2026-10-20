import { describe, expect, it } from "vitest";
import { editReviewers, NO_REVIEWER_EDIT, settleReviewers, undoReviewers, withReviewers } from "./prModel";
import { askForReview, heldWords, mergeBox, parseGitHubUrl, type PrCheck, rerunTargets, reviewerSuggestions, savedTab, saveTab, sizeWords, summarizeChecks } from "./prModel";

const check = (name: string, status: string, conclusion: string, runId: number | null): PrCheck => ({ id: 1, name, status, conclusion, url: "", runId });

describe("GIT-051 the pull request page's rules", () => {
  it("reads a pasted GitHub address and nothing else", () => {
    expect(parseGitHubUrl("https://github.com/acme/app/pull/12")).toEqual({ host: "github.com", repo: "acme/app", number: 12, kind: "pull" });
    expect(parseGitHubUrl(" https://git.corp.example/acme/app/issues/3/ ")).toEqual({ host: "git.corp.example", repo: "acme/app", number: 3, kind: "issue" });
    expect(parseGitHubUrl("https://github.com/acme/app/pull/12/files")?.number).toBe(12);
    for (const bad of ["http://github.com/acme/app/pull/12", "https://github.com/acme/app", "https://github.com/acme/app/pull/0", "https://github.com/../app/pull/1", "https://u:p@github.com/acme/app/pull/1", "javascript:alert(1)", "not a url", "https://github.com/a/b/pull/1/x"]) {
      expect(parseGitHubUrl(bad), bad).toBeNull();
    }
  });
  it("sums checks into one line and a tone", () => {
    expect(summarizeChecks([]).tone).toBe("none");
    expect(summarizeChecks([check("a", "completed", "success", 1), check("b", "completed", "failure", 1)])).toMatchObject({ tone: "bad", failed: 1, passed: 1, label: "1 failing, 1 passing" });
    expect(summarizeChecks([check("a", "in_progress", "", 1), check("b", "completed", "success", 1)])).toMatchObject({ tone: "wait", label: "1 running, 1 passing" });
    expect(summarizeChecks([check("a", "completed", "success", 1), check("b", "completed", "skipped", 1)])).toMatchObject({ tone: "ok", label: "2 of 2 passing" });
  });
  it("reruns each workflow run once, and only the failing ones for 'failed'", () => {
    const list = [check("a", "completed", "success", 1), check("b", "completed", "failure", 1), check("c", "completed", "success", 2), check("d", "completed", "failure", 3), check("e", "completed", "failure", null)];
    expect(rerunTargets(list, false)).toEqual([1, 2, 3]);
    expect(rerunTargets(list, true)).toEqual([1, 3]);
    expect(rerunTargets([], true)).toEqual([]);
  });
  it("counts a check that needs action as failing, so rerun failed includes its run", () => {
    const list = [check("a", "completed", "success", 1), check("b", "completed", "action_required", 2)];
    expect(rerunTargets(list, true)).toEqual([2]);
  });
  it("suggests reviewers who are not the author or already on it, and refuses the sixteenth", () => {
    const people = ["ana", "bo", "cy", "dee"].map((login) => ({ login, avatar: "" }));
    const page = { author: "ana", reviewers: [{ login: "bo", state: "approved" }, { login: "cy", state: "dismissed" }] };
    expect(reviewerSuggestions(people, page, "").map((p) => p.login)).toEqual(["cy", "dee"]);
    expect(reviewerSuggestions(people, page, "@de").map((p) => p.login)).toEqual(["dee"]);
    const full = { reviewers: Array.from({ length: 15 }, (_, i) => ({ login: `u${i}`, state: "requested" })) };
    const refused = askForReview(full, ["extra"]);
    expect(refused.ok).toBe(false);
    expect(askForReview(full, ["u1"])).toEqual({ ok: true, add: [] });
    const done = askForReview({ reviewers: [{ login: "bo", state: "approved" }] }, ["bo", "cy"]);
    expect(done).toEqual({ ok: true, add: ["bo", "cy"] });
  });
  it("says why a pull request cannot be merged from the box", () => {
    expect(mergeBox({ state: "open", draft: false, mergeableState: "clean" }).canMerge).toBe(true);
    expect(mergeBox({ state: "open", draft: false, mergeableState: "unstable" }).canMerge).toBe(true);
    for (const p of [{ state: "merged", draft: false, mergeableState: "clean" }, { state: "closed", draft: false, mergeableState: "clean" }, { state: "open", draft: true, mergeableState: "clean" }, { state: "open", draft: false, mergeableState: "dirty" }, { state: "open", draft: false, mergeableState: "blocked" }, { state: "open", draft: false, mergeableState: "behind" }]) {
      expect(mergeBox(p).canMerge, JSON.stringify(p)).toBe(false);
    }
  });
  it("needs the repository added in Kolux to merge, and says so", () => {
    const open = { state: "open", draft: false, mergeableState: "clean" };
    const no = mergeBox(open, false);
    expect(no.canMerge).toBe(false);
    expect(no.reason).toBe("Add this repository in Kolux to merge from here.");
    expect(mergeBox(open, true).canMerge).toBe(true);
    expect(mergeBox(open).canMerge).toBe(true);
    // a merged pull request still reads as merged, whether or not the repository is added
    expect(mergeBox({ ...open, state: "merged" }, false).reason).toBe("Already merged.");
  });
  it("does not offer a merge while GitHub is still working out whether it can", () => {
    for (const mergeableState of ["unknown", "", "something-new"]) {
      const b = mergeBox({ state: "open", draft: false, mergeableState });
      expect(b.canMerge, mergeableState).toBe(false);
      expect(b.reason, mergeableState).toBe("GitHub is still checking whether it can merge.");
    }
    expect(mergeBox({ state: "open", draft: false, mergeableState: "has_hooks" }).canMerge).toBe(true);
  });
  it("keeps the tab between visits, per pull request, and survives storage that throws", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const t = { host: "github.com", repo: "acme/app", number: 7 };
    expect(savedTab(store, t)).toBe("conversation");
    saveTab(store, t, "checks");
    expect(savedTab(store, t)).toBe("checks");
    expect(savedTab(store, { ...t, number: 8 })).toBe("conversation");
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    expect(savedTab(broken, t)).toBe("conversation");
    expect(() => saveTab(broken, t, "files")).not.toThrow();
  });
});

describe("GIT-039 (T-176-d) a held-back file diff names the limit that held it", () => {
  const limits = { lines: 20_000, chars: 2 * 1024 * 1024, budget: 8 * 1024 * 1024 };
  it("words each reason from the backend's own numbers", () => {
    expect(heldWords({ held: "lines", patchLines: 31_500, patchChars: 900_000 }, limits)).toBe("Held back: this diff is 31,500 lines, over the limit of 20,000 lines.");
    expect(heldWords({ held: "size", patchLines: 100, patchChars: 3 * 1024 * 1024 }, limits)).toBe("Held back: this diff is 3.0 MB, over the limit of 2.0 MB.");
    expect(heldWords({ held: "budget", patchLines: 100, patchChars: 1.5 * 1024 * 1024 }, limits)).toBe("Held back: the diffs of this pull request are over the 8.0 MB Kolux sends at once, so this one (1.5 MB) waits until you load it.");
    expect(heldWords({ held: null }, limits)).toBeNull();
    expect(heldWords({}, limits)).toBeNull();
  });
  it("sizes read in KB under a megabyte", () => {
    expect(sizeWords(1)).toBe("1 KB");
    expect(sizeWords(150 * 1024)).toBe("150 KB");
  });
});

describe("T-281 (GIT-048): review requests", () => {
  const list = [{ login: "ann", state: "approved" }, { login: "bob", state: "requested" }];
  it("show at once, are not flipped back by a stale page, and settle when GitHub agrees", () => {
    const p = editReviewers(editReviewers(NO_REVIEWER_EDIT, ["cy"], []), [], ["bob"]);
    expect(withReviewers(list, p)).toEqual([{ login: "ann", state: "approved" }, { login: "cy", state: "requested" }]);
    expect(settleReviewers(list, p)).toEqual(p);
    expect(settleReviewers([{ login: "ann", state: "approved" }, { login: "Cy", state: "requested" }], p)).toEqual(NO_REVIEWER_EDIT);
    // a take-back never hides a finished review
    expect(withReviewers(list, editReviewers(NO_REVIEWER_EDIT, [], ["ann"]))).toEqual(list);
  });
  it("a failed write puts back only itself; asking again cancels a take-back", () => {
    const p = editReviewers(editReviewers(NO_REVIEWER_EDIT, ["cy"], []), ["dee"], []);
    expect(undoReviewers(p, ["cy"], [])).toEqual({ ask: ["dee"], drop: [] });
    expect(editReviewers(editReviewers(NO_REVIEWER_EDIT, [], ["bob"]), ["bob"], [])).toEqual({ ask: ["bob"], drop: [] });
  });
});
