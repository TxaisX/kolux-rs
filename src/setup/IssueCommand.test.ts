import { describe, expect, it } from "vitest";
import { issueCommand, issueToRun } from "./IssueCommand";

describe("PROJ-036 the issue command", () => {
  it("runs only for a linked issue", () => {
    expect(issueToRun(null)).toBeNull();
    expect(issueToRun({ kind: "pull", number: 7, title: "x", url: "u" })).toBeNull();
    expect(issueToRun({ kind: "issue", number: 0, title: "x", url: "u" })).toBeNull();
    expect(issueToRun({ kind: "issue", number: 12, title: "x", url: "u" })?.number).toBe(12);
    expect(issueToRun({ number: 12, title: "x", url: "u" })?.number).toBe(12);
  });

  it("asks Rust for the line with the issue's number and address, never its title", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const fake = async <T,>(cmd: string, args: Record<string, unknown>) => {
      calls.push([cmd, args]);
      if (cmd === "script_trust_needed") return null as T;
      return { line: { program: "sh", args: ["-c", "work 12"], script: "work 12" }, shared: true, command: "work {{issue}}" } as T;
    };
    const run = await issueCommand("C:/r", "C:/w", { kind: "issue", number: 12, title: "$(rm -rf /)", url: "https://github.com/o/r/issues/12" }, fake);
    expect(run?.line.args).toEqual(["-c", "work 12"]);
    expect(calls).toEqual([["script_trust_needed", { path: "C:/w", kind: "issue", root: "C:/r" }], ["workspace_issue_command", { root: "C:/r", path: "C:/w", number: 12, url: "https://github.com/o/r/issues/12" }]]);
    expect(await issueCommand("C:/r", "C:/w", { kind: "pull", number: 3, title: "", url: "" }, fake)).toBeNull();
    expect(calls.length).toBe(2);
  });
});
