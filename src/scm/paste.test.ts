import { describe, expect, it } from "vitest";
import { githubItem, workspaceFor } from "./paste";

describe("T-315: a pasted GitHub link (GIT-058)", () => {
  it("cleans a pull request or issue link and refuses anything else", () => {
    expect(githubItem("  https://github.com/o/r/pull/12/files?w=1#diff ")).toBe("https://github.com/o/r/pull/12");
    expect(githubItem("https://github.com/o/r/issues/7")).toBe("https://github.com/o/r/issues/7");
    expect(githubItem("https://ghe.example.com/team/app/pull/3", ["github.com", "ghe.example.com"])).toBe("https://ghe.example.com/team/app/pull/3");
    expect(githubItem("https://GitHub.com/o/my.repo_1/pull/3")).toBe("https://github.com/o/my.repo_1/pull/3");
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

describe("FIX-2: a pasted link only ever names the host it shows", () => {
  it("refuses a user, a password, a port, a host not on the list and odd owner or repo names", () => {
    for (const no of [
      "https://github.com@evil.example/o/r/pull/1",
      "https://user:TOKEN@github.com/o/r/pull/1",
      "https://github.com:8443/o/r/pull/1",
      "https://ghe.example.com/team/app/pull/3",
      "https://github.com/../r/pull/1",
      "https://github.com/o/../pull/1",
      "https://github.com/o/./pull/1",
      "https://github.com/-x/r/pull/1",
      "https://github.com/o/r%2Fx/pull/1",
      "https://github.com/o:x/r/pull/1",
      "https://github.com/o/r\\x/pull/1",
    ]) {
      expect(githubItem(no), no).toBeNull();
    }
  });
});
