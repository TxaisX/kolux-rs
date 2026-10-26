import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let details: { name: string | null; item: string | null; comment: string } | Error = { name: null, item: null, comment: "" };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "workspace_details_get") {
      if (details instanceof Error) throw details;
      return details;
    }
    return ["Title", "Body"];
  },
}));

import { linkedIssue, realPorts } from "./oneClick";
import type { Writer } from "./generate";

const writer: Writer = { mode: "agent", agent: "claude", model: null, effort: null, command: null, instructions: "" };
const request = () => calls.find((c) => c.cmd === "scm_pr_text")!.args;

describe("GIT-024 generated description carries the linked issue", () => {
  beforeEach(() => {
    calls.length = 0;
    details = { name: null, item: null, comment: "" };
  });

  it("reads an issue address and a bare number, never a pull request or free text", () => {
    expect(linkedIssue("https://github.com/o/r/issues/12", "Fix login")).toEqual({ number: 12, title: "Fix login", body: null });
    expect(linkedIssue("#7", null)).toEqual({ number: 7, title: "", body: null });
    expect(linkedIssue("https://github.com/o/r/pull/3", "x")).toBeNull();
    expect(linkedIssue("some ticket", "x")).toBeNull();
    expect(linkedIssue(null, "x")).toBeNull();
  });

  it("sends the linked issue with the description request", async () => {
    details = { name: "Fix login", item: "https://github.com/o/r/issues/12", comment: "" };
    await realPorts(writer).text("C:/w", "origin/main");
    expect(calls.find((c) => c.cmd === "workspace_details_get")!.args).toEqual({ path: "C:/w" });
    expect(request().issue).toEqual({ number: 12, title: "Fix login", body: null });
  });

  it("sends no issue when none is linked, or when the link cannot be read", async () => {
    await realPorts(writer).text("C:/w", "origin/main");
    expect(request().issue).toBeNull();
    calls.length = 0;
    details = new Error("no store");
    await realPorts(writer).text("C:/w", "origin/main");
    expect(request().issue).toBeNull();
  });
});
