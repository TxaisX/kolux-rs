import { describe, expect, it } from "vitest";
import { existingWorkspace, linkKey, linkedRows, workItem, workLabel } from "./workStart";

describe("GIT-049 starting or resuming a workspace from an item", () => {
  it("turns a task row into the item the create command takes", () => {
    expect(workItem({ kind: "issue", number: 12, repo: "acme/app" }, "github.com")).toEqual({ host: "github.com", owner: "acme", repo: "app", kind: "issue", number: 12 });
    expect(workItem({ kind: "pr", number: 3, repo: "acme/app" }, "git.corp.example")?.kind).toBe("pull");
    expect(workItem({ kind: "issue", number: 1, repo: "acme" }, "github.com")).toBeNull();
    expect(workItem({ kind: "issue", number: 1, repo: "a/b/c" }, "github.com")).toBeNull();
    expect(workItem({ kind: "issue", number: 0, repo: "a/b" }, "github.com")).toBeNull();
  });
  it("starts a workspace on the row's own host, not the first chosen repository's", () => {
    expect(workItem({ kind: "issue", number: 12, repo: "acme/app", host: "git.corp.example" }, "github.com")?.host).toBe("git.corp.example");
    expect(workItem({ kind: "issue", number: 12, repo: "acme/app" }, "github.com")?.host).toBe("github.com");
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
  it("keys the workspace lists by host and repository, without case", () => {
    expect(linkKey("GitHub.com", "Acme/App")).toBe("github.com/acme/app");
    expect(linkKey("github.com", "acme/app")).not.toBe(linkKey("git.corp.example", "acme/app"));
  });
  it("offers resume when one exists, else start", () => {
    expect(workLabel("C:/x", { kind: "issue" })).toBe("Resume workspace");
    expect(workLabel(null, { kind: "issue" })).toBe("Start workspace");
    expect(workLabel(null, { kind: "pr" })).toBe("Check out in a workspace");
  });
  it("lists the workspaces of an opened or pasted address's repository even when the picker has not chosen it", () => {
    const row = (host: string, repo: string, checking = false) => ({ key: `${host}/${repo}`, host, repo, checking });
    const chosen = [row("github.com", "acme/app")];
    const all = [...chosen, row("github.com", "acme/lib"), row("git.corp.example", "acme/lib"), row("", "", true)];
    expect(linkedRows(chosen, all, [])).toEqual(chosen);
    expect(linkedRows(chosen, all, [{ host: "github.com", repo: "Acme/Lib" }])).toEqual([chosen[0], all[1]]);
    // The same name on another host is another repository; an address of a repository with no project adds nothing.
    expect(linkedRows(chosen, all, [{ host: "git.corp.example", repo: "acme/lib" }])).toEqual([chosen[0], all[2]]);
    expect(linkedRows(chosen, all, [{ host: "github.com", repo: "acme/unknown" }, { host: "github.com", repo: "acme/app" }])).toEqual(chosen);
  });
});
