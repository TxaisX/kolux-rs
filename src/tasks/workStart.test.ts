import { describe, expect, it } from "vitest";
import { existingWorkspace, workItem, workLabel } from "./workStart";

describe("GIT-049 starting or resuming a workspace from an item", () => {
  it("turns a task row into the item the create command takes", () => {
    expect(workItem({ kind: "issue", number: 12, repo: "acme/app" }, "github.com")).toEqual({ host: "github.com", owner: "acme", repo: "app", kind: "issue", number: 12 });
    expect(workItem({ kind: "pr", number: 3, repo: "acme/app" }, "git.corp.example")?.kind).toBe("pull");
    expect(workItem({ kind: "issue", number: 1, repo: "acme" }, "github.com")).toBeNull();
    expect(workItem({ kind: "issue", number: 1, repo: "a/b/c" }, "github.com")).toBeNull();
    expect(workItem({ kind: "issue", number: 0, repo: "a/b" }, "github.com")).toBeNull();
  });
  it("finds the workspace already linked to the number, never the main checkout", () => {
    const list = [
      { path: "C:/dev/app", isMain: true, number: 12 },
      { path: "C:/dev/app-ws/fix", isMain: false, number: 12 },
      { path: "C:/dev/app-ws/other", isMain: false, number: 7 },
      { path: "C:/dev/app-ws/none", isMain: false },
    ];
    expect(existingWorkspace(list, 12)).toBe("C:/dev/app-ws/fix");
    expect(existingWorkspace(list, 99)).toBeNull();
    expect(existingWorkspace([list[0]], 12)).toBeNull();
  });
  it("offers resume when one exists, else start", () => {
    expect(workLabel("C:/x", { kind: "issue" })).toBe("Resume workspace");
    expect(workLabel(null, { kind: "issue" })).toBe("Start workspace");
    expect(workLabel(null, { kind: "pr" })).toBe("Check out in a workspace");
  });
});
