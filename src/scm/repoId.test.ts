import { beforeEach, describe, expect, it, vi } from "vitest";

let reply: () => unknown = () => null;
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return reply();
  },
}));
import { readRepoRef, typedRepoId } from "./repoId";

describe("row 917 review fixes: repository ids from the app", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("readRepoRef keeps the other keys the repository is known by", async () => {
    reply = () => ({ id: "a/b", legacy: "o/n", also: ["c/d", 4, "/root"] });
    expect(await readRepoRef("/w")).toEqual({ id: "a/b", legacy: "o/n", also: ["c/d", "/root"] });
  });
  it("a pasted entry is normalized by the app before it is saved", async () => {
    reply = () => "gitlab.com/Team/App";
    expect(await typedRepoId("https://GitLab.com/Team/App.git")).toBe("gitlab.com/Team/App");
    expect(calls).toEqual([{ cmd: "scm_repo_id_of", args: { text: "https://GitLab.com/Team/App.git" } }]);
  });
  it("an entry the app cannot normalize is refused, not saved raw", async () => {
    reply = () => {
      throw new Error("no");
    };
    expect(await typedRepoId("x")).toBeNull();
  });
});
