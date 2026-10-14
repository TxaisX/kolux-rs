import { describe, expect, it } from "vitest";
import { githubItem, workspaceFor } from "./paste";

describe("T-315: a pasted GitHub link (GIT-058)", () => {
  it("cleans a pull request or issue link and refuses anything else", () => {
    expect(githubItem("  https://github.com/o/r/pull/12/files?w=1#diff ")).toBe("https://github.com/o/r/pull/12");
    expect(githubItem("https://github.com/o/r/issues/7")).toBe("https://github.com/o/r/issues/7");
    expect(githubItem("https://ghe.example.com/team/app/pull/3")).toBe("https://ghe.example.com/team/app/pull/3");
    for (const no of ["http://github.com/o/r/pull/1", "https://github.com/o/r/pull/", "https://github.com/o/r/pull/1x", "https://github.com/o/r", "fix the bug", "https://github.com/o/r/pull/1 && calc"]) {
      expect(githubItem(no)).toBeNull();
    }
  });

  it("finds the workspace already linked to that pull request", () => {
    const linked = { "G:/w/a": "https://github.com/o/r/pull/12", "G:/w/b": "https://github.com/o/r/pull/9#x" };
    expect(workspaceFor("https://github.com/o/r/pull/9", linked)).toBe("G:/w/b");
    expect(workspaceFor("https://github.com/o/r/pull/5", linked)).toBeNull();
  });
});
