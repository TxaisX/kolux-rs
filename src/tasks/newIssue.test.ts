import { describe, expect, it } from "vitest";
import { DRAFT_MAX, draftFrom, draftToSave, emptyDraft, issueTargets, openDraft, withRepo } from "./newIssue";

const d = (over = {}) => ({ ...emptyDraft("acme/app"), title: "Crash on start", body: "Steps", labels: ["bug"], assignees: ["ana"], ...over });

describe("T-231-d GIT-046 new issue drafts", () => {
  it("targets the repositories the list shows, the first selected one first, each once", () => {
    expect(issueTargets("up/stream", "me/fork")).toEqual(["up/stream", "me/fork"]);
    expect(issueTargets("me/app", "me/app")).toEqual(["me/app"]);
    expect(issueTargets("", "me/app")).toEqual(["me/app"]);
  });

  it("starts on the first selected repository, or brings back the unfinished draft", () => {
    expect(openDraft(null, ["up/stream", "me/fork"])).toEqual(emptyDraft("up/stream"));
    const saved = d({ repo: "me/fork" });
    expect(openDraft(saved, ["up/stream", "me/fork"])).toEqual(saved);
  });

  it("a draft whose repository went away falls back to the first selected one without its labels and assignees", () => {
    expect(openDraft(d({ repo: "gone/repo" }), ["up/stream", "me/fork"])).toEqual({ ...d(), repo: "up/stream", labels: [], assignees: [] });
  });

  it("changing repository drops the labels and assignees of the previous one", () => {
    expect(withRepo(d(), "acme/other")).toEqual({ ...d(), repo: "acme/other", labels: [], assignees: [] });
    expect(withRepo(d(), "acme/app")).toEqual(d());
  });

  it("an empty draft clears what was kept; a very long body is not saved but the issue can still be created", () => {
    expect(draftToSave(emptyDraft("acme/app"))).toBeNull();
    expect(draftToSave(d({ title: "  ", body: "", labels: [], assignees: [] }))).toBeNull();
    expect(draftToSave(d())).toEqual(d());
    expect(draftToSave(d({ body: "x".repeat(DRAFT_MAX + 1) }))).toBe("too-long");
  });

  it("a saved draft is read back only when it has the right shape", () => {
    expect(draftFrom(d())).toEqual(d());
    expect(draftFrom({ repo: "acme/app", title: 3 })).toBeNull();
    expect(draftFrom({ ...d(), labels: ["bug", 4], assignees: ["bad login", "ana"] })).toEqual({ ...d(), labels: ["bug"], assignees: ["ana"] });
    expect(draftFrom("nope")).toBeNull();
    expect(draftFrom({ ...d(), repo: "../x" })).toBeNull();
  });
});
