import { describe, expect, it } from "vitest";
import { closingDraft, createBusy, createdHere, createOnce, DRAFT_MAX, lastCreateFailure, closesDialog, titleLength, pickableLabels, TITLE_MAX, draftFrom, draftToSave, emptyDraft, issueTargets, openDraft, watchCreate, withRepo } from "./newIssue";

// FIX-5: a create belongs to the host and repository it was sent to.
const S = { host: "ghe.corp", repo: "acme/app" };

const d = (over = {}) => ({ ...emptyDraft("github.com", "acme/app"), title: "Crash on start", body: "Steps", labels: ["bug"], assignees: ["ana"], ...over });

describe("T-231-d GIT-046 new issue drafts", () => {
  it("targets the repositories the list shows, the first selected one first, each once", () => {
    expect(issueTargets("up/stream", "me/fork")).toEqual(["up/stream", "me/fork"]);
    expect(issueTargets("me/app", "me/app")).toEqual(["me/app"]);
    expect(issueTargets("", "me/app")).toEqual(["me/app"]);
  });

  it("starts on the first selected repository, or brings back the unfinished draft", () => {
    expect(openDraft(null, ["up/stream", "me/fork"], "github.com")).toEqual({ draft: emptyDraft("github.com", "up/stream"), elsewhere: null });
    const saved = d({ repo: "me/fork" });
    expect(openDraft(saved, ["up/stream", "me/fork"], "GitHub.com")).toEqual({ draft: saved, elsewhere: null });
  });

  it("a draft whose repository went away falls back to the first selected one without its labels and assignees", () => {
    expect(openDraft(d({ repo: "gone/repo" }), ["up/stream", "me/fork"], "github.com").draft).toEqual({ ...d(), repo: "up/stream", labels: [], assignees: [] });
  });

  it("FIX-2 FS 2: a draft made for another GitHub host never comes back aimed at a same-named repository here", () => {
    const internal = d({ host: "ghe.corp", title: "Internal bug", body: "secret steps" });
    const got = openDraft(internal, ["acme/app"], "github.com");
    expect(got.draft).toEqual(emptyDraft("github.com", "acme/app"));
    expect(got.elsewhere).toEqual(internal);
    expect(openDraft(internal, ["acme/app"], "GHE.corp")).toEqual({ draft: internal, elsewhere: null });
  });

  it("changing repository drops the labels and assignees of the previous one and keeps the host", () => {
    expect(withRepo(d({ host: "ghe.corp" }), "acme/other")).toEqual({ ...d({ host: "ghe.corp" }), repo: "acme/other", labels: [], assignees: [] });
    expect(withRepo(d(), "acme/app")).toEqual(d());
  });

  it("an empty draft clears what was kept; a very long body is not saved but the issue can still be created", () => {
    expect(draftToSave(emptyDraft("github.com", "acme/app"))).toBeNull();
    expect(draftToSave(d({ title: "  ", body: "", labels: [], assignees: [] }))).toBeNull();
    expect(draftToSave(d())).toEqual(d());
    expect(draftToSave(d({ body: "x".repeat(DRAFT_MAX + 1) }))).toBe("too-long");
  });

  it("a saved draft is read back only when it has the right shape, host included", () => {
    expect(draftFrom(d())).toEqual(d());
    expect(draftFrom(d({ host: "ghe.corp:8443" }))).toEqual(d({ host: "ghe.corp:8443" }));
    expect(draftFrom({ repo: "acme/app", title: 3 })).toBeNull();
    expect(draftFrom({ ...d(), labels: ["bug", 4], assignees: ["bad login", "ana"] })).toEqual({ ...d(), labels: ["bug"], assignees: ["ana"] });
    expect(draftFrom("nope")).toBeNull();
    expect(draftFrom({ ...d(), repo: "../x" })).toBeNull();
    const { host: _gone, ...noHost } = d();
    expect(draftFrom(noHost)).toBeNull();
    expect(draftFrom(d({ host: "-x.corp" }))).toBeNull();
    expect(draftFrom(d({ host: "evil host" }))).toBeNull();
  });

  it("FIX-2 AFTER 2: closing keeps label and assignee text that was typed but never left", () => {
    expect(closingDraft(d({ labels: [], assignees: [] }), " bug, ui ,bug", "ana, -bad, bo")).toEqual(d({ labels: ["bug", "ui"], assignees: ["ana", "-bad", "bo"] }));
  });
});

describe("FIX-2 FS 1: one New issue create at a time across close and reopen", () => {
  it("a second create while the first is out is refused, and the flag clears when it settles", async () => {
    const seen: string[] = [];
    const off = watchCreate((s) => seen.push(s));
    let finish: (v: number) => void = () => {};
    const sends: number[] = [];
    const first = createOnce(() => new Promise<number>((r) => { sends.push(1); finish = r; }), S);
    expect(createBusy()).toBe(true);
    // The dialog was closed and opened again while gh is slow: Create from the new one is refused.
    expect(await createOnce(async () => { sends.push(2); return 2; }, S)).toBeNull();
    expect(sends).toEqual([1]);
    finish(12);
    expect(await first).toEqual({ ok: true, value: 12 });
    expect(createBusy()).toBe(false);
    expect(await createOnce(() => Promise.reject("gh: Validation Failed"), S)).toEqual({ ok: false, error: "gh: Validation Failed" });
    expect(createBusy()).toBe(false);
    off();
    expect(seen).toEqual(["busy", "created", "busy", "failed"]);
  });
});

describe("FIX-3: what a New issue create reports after the user has moved on", () => {
  it("a failed create tells every watcher the error, so a dialog opened later can show it", async () => {
    const seen: [string, string | undefined, string | undefined][] = [];
    const off = watchCreate((e, err, scope) => seen.push([e, err, scope?.repo]));
    expect(await createOnce(() => Promise.reject("gh: HTTP 504 timeout"), S)).toEqual({ ok: false, error: "gh: HTTP 504 timeout" });
    off();
    expect(seen).toEqual([["busy", undefined, "acme/app"], ["failed", "gh: HTTP 504 timeout", "acme/app"]]);
  });

  it("an issue lands in the list only when its host and repository are the ones on screen", () => {
    const here = { host: "ghe.corp", repos: ["acme/app", "up/stream"] };
    expect(createdHere(here, "ghe.corp", "acme/app")).toBe(true);
    expect(createdHere(here, "GHE.corp", "Up/Stream")).toBe(true);
    // The user switched to a github.com workspace of the same name while gh was slow.
    expect(createdHere({ host: "github.com", repos: ["acme/app"] }, "ghe.corp", "acme/app")).toBe(false);
    expect(createdHere(here, "ghe.corp", "acme/other")).toBe(false);
    expect(createdHere(null, "ghe.corp", "acme/app")).toBe(false);
  });

  it("a create that failed while no dialog was open is still there when New issue opens, until the next create", async () => {
    // Nobody is watching: the user left Tasks while "Creating…".
    expect(await createOnce(() => Promise.reject("gh: HTTP 504 timeout"), S)).toEqual({ ok: false, error: "gh: HTTP 504 timeout" });
    expect(lastCreateFailure(S.host, S.repo)).toBe("gh: HTTP 504 timeout");
    // The next create clears it while it runs, and a create that goes through leaves nothing.
    let finish: (n: number) => void = () => {};
    const next = createOnce(() => new Promise<number>((r) => (finish = r)), S);
    expect(lastCreateFailure(S.host, S.repo)).toBeNull();
    finish(1);
    expect(await next).toEqual({ ok: true, value: 1 });
    expect(lastCreateFailure(S.host, S.repo)).toBeNull();
    // A newer failure replaces an older one.
    await createOnce(() => Promise.reject("first"), S);
    await createOnce(() => Promise.reject("second"), S);
    expect(lastCreateFailure(S.host, S.repo)).toBe("second");
    await createOnce(async () => 2, S);
    expect(lastCreateFailure(S.host, S.repo)).toBeNull();
  });

  it("FIX-5: a failure shows only for the host and repository it was sent to, not in every later New issue", async () => {
    await createOnce(() => Promise.reject("gh: HTTP 504 timeout"), S);
    expect(lastCreateFailure("ghe.corp", "acme/app")).toBe("gh: HTTP 504 timeout");
    expect(lastCreateFailure("GHE.corp", "Acme/App")).toBe("gh: HTTP 504 timeout");
    // Another repository on the same host, and the same-named repository on github.com, see nothing.
    expect(lastCreateFailure("ghe.corp", "acme/other")).toBeNull();
    expect(lastCreateFailure("github.com", "acme/app")).toBeNull();
    // Nothing is lost by asking from elsewhere: the right dialog still gets it.
    expect(lastCreateFailure("ghe.corp", "acme/app")).toBe("gh: HTTP 504 timeout");
    await createOnce(async () => 1, S);
    expect(lastCreateFailure("ghe.corp", "acme/app")).toBeNull();
  });

  it("a create that comes back closes its own dialog, or any dialog when the issue belongs on screen, but an older opening's create leaves a newer dialog open when its issue is somewhere else", () => {
    expect(closesDialog(false, 3, 3)).toBe(true);
    expect(closesDialog(true, 3, 4)).toBe(true);
    // The user switched workspace, the old create came back, and a dialog was opened in the new one.
    expect(closesDialog(false, 3, 4)).toBe(false);
  });

  it("a title is counted in characters, the way GitHub counts them, not in UTF-16 units", () => {
    expect(titleLength("  hello ")).toBe(5);
    expect(titleLength("😀".repeat(200))).toBe(200);
    expect("😀".repeat(200).length).toBe(400);
  });

  it("label suggestions with a comma are left out (the field splits on commas) and titles stop at 256", () => {
    expect(pickableLabels(["bug", "a, b", "ui"])).toEqual(["bug", "ui"]);
    expect(TITLE_MAX).toBe(256);
  });
});
