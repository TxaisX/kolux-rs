import { describe, expect, it } from "vitest";
import { ISSUES_REPO, issueTitle, issueUrl } from "./crash";
import { SECTIONS } from "./projects/WorktreePalette";

const report = { id: "001", text: "Kolux RS 1.2.3 crashed\nWhen: 5 (unix seconds)\nWhat: boom at src/x.rs:9\n" };

describe("APP-039 crash report", () => {
  it("marks the issue title as a crash report and names what happened", () => {
    expect(issueTitle(report)).toBe("[Crash report] Kolux RS 1.2.3: boom at src/x.rs:9");
    expect(issueTitle(null)).toBe("[Crash report] Kolux RS");
  });

  it("opens a new GitHub issue with the details only when there is a repository", () => {
    expect(issueUrl("", report)).toBeNull();
    const url = new URL(issueUrl("owner/kolux-rs", report)!);
    expect(url.origin + url.pathname).toBe("https://github.com/owner/kolux-rs/issues/new");
    expect(url.searchParams.get("title")).toBe(issueTitle(report));
    expect(url.searchParams.get("body")).toContain("What: boom");
  });

  it("lists Report Crash under Help in the search palette", () => {
    expect(SECTIONS).toContain("Help");
  });

  it("has no repository until Kolux RS has a public one (OD-16)", () => {
    expect(ISSUES_REPO).toBe("");
  });
});
