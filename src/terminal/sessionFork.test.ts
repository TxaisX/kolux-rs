import { describe, expect, it } from "vitest";
import { baseArgs, beginFork, canContinue, contextText, continueLaunch, endFork, forkLaunch, newFork, sessionActions, type SessionPane } from "./sessionFork";
import { autoPowerShell, shellIconOf, windowsShellMenu, withDefaultFirst, type ShellEntry } from "./shellChoice";

const P = (over: Partial<SessionPane> = {}): SessionPane => ({ agent: "claude", session: "abc-123", program: null, args: [], ...over });

describe("TERM-037 continue and fork", () => {
  it("only an agent pane with a known session qualifies", () => {
    expect(canContinue(P())).toBe(true);
    expect(canContinue(P({ session: undefined }))).toBe(false);
    expect(canContinue(P({ agent: "terminal" }))).toBe(false);
    expect(canContinue(P({ kind: "browser" }))).toBe(false);
    expect(canContinue(P({ seats: [] }))).toBe(false);
    expect(sessionActions(P({ agent: "gemini" }))).toEqual([]);
    expect(sessionActions(P()).map((a) => a.id)).toEqual(["continueSession", "forkSession", "copyContext"]);
  });
  it("claude resumes by id, a fork adds --fork-session", () => {
    expect(continueLaunch(P({ args: ["--model", "opus"] }))).toEqual({ program: "claude", args: ["--model", "opus", "--resume", "abc-123"] });
    expect(forkLaunch(P())).toEqual({ program: "claude", args: ["--resume", "abc-123", "--fork-session"] });
  });
  it("codex uses its resume and fork sub-commands", () => {
    expect(continueLaunch(P({ agent: "codex", program: "codex.cmd" }))).toEqual({ program: "codex.cmd", args: ["resume", "abc-123"] });
    expect(forkLaunch(P({ agent: "codex" }))).toEqual({ program: "codex", args: ["fork", "abc-123"] });
  });
  it("does not stack a pane's own resume flags on the new ones", () => {
    expect(baseArgs("claude", ["--resume", "old", "--continue", "--fork-session", "-x"])).toEqual(["-x"]);
    expect(baseArgs("codex", ["resume", "old", "--full-auto"])).toEqual(["--full-auto"]);
    expect(baseArgs("codex", ["fork", "--full-auto"])).toEqual(["--full-auto"]);
    expect(forkLaunch(P({ args: ["--resume", "old"] }))?.args).toEqual(["--resume", "abc-123", "--fork-session"]);
  });
  it("a double click on Create starts one fork", () => {
    const a = beginFork(newFork("try b"));
    expect(a.go).toBe(true);
    expect(beginFork(a.draft).go).toBe(false);
    expect(beginFork(endFork(a.draft)).go).toBe(true);
  });
  it("Copy Context is plain, short and keeps the newest lines", () => {
    const recent = ["\u001b[32mgreen\u001b[0m   ", "", ...Array.from({ length: 60 }, (_, i) => `line ${i}`)];
    const t = contextText({ ...P(), label: "Claude", cwd: "C:\\w", branch: "main" }, { status: "idle", recent });
    expect(t).toContain("Agent session: Claude");
    expect(t).toContain("Session id: abc-123");
    expect(t).not.toContain("green");
    expect(t).not.toContain("\u001b");
    expect(t).toContain("line 59");
    expect(t).not.toContain("line 5\n");
    expect(contextText(P(), { recent: ["x".repeat(20000)] }).length).toBeLessThan(8100);
  });
});

const S = (id: string, program = id): ShellEntry => ({ id, name: id, program, args: [] });

describe("TERM-043 Windows shell choice", () => {
  const all = [S("pwsh"), S("powershell"), S("cmd"), S("gitbash", "C:\\Program Files\\Git\\bin\\bash.exe"), S("wsl")];
  it("shows the menu only for a local Windows client, without WSL", () => {
    expect(windowsShellMenu(all, { windows: true, local: true }).map((s) => s.id)).toEqual(["pwsh", "powershell", "cmd", "gitbash"]);
    expect(windowsShellMenu(all, { windows: false, local: true })).toEqual([]);
    expect(windowsShellMenu(all, { windows: true, local: false })).toEqual([]);
  });
  it("a tab keeps the icon of the shell it started with", () => {
    expect(shellIconOf("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("pwsh");
    expect(shellIconOf("powershell.exe")).toBe("powershell");
    expect(shellIconOf("C:\\Windows\\System32\\cmd.exe")).toBe("cmd");
    expect(shellIconOf("C:\\Program Files\\Git\\bin\\bash.exe")).toBe("gitbash");
    expect(shellIconOf("/usr/bin/zsh")).toBe("shell");
    expect(shellIconOf(null)).toBe("shell");
  });
  it("PowerShell auto prefers 7, and the settings pick goes first", () => {
    expect(autoPowerShell(all)?.id).toBe("pwsh");
    expect(autoPowerShell(all.filter((s) => s.id !== "pwsh"))?.id).toBe("powershell");
    expect(autoPowerShell([S("cmd")])).toBeNull();
    expect(withDefaultFirst(all, "cmd").map((s) => s.id).slice(0, 3)).toEqual(["cmd", "pwsh", "powershell"]);
    expect(withDefaultFirst(all, "auto")).toBe(all);
    expect(withDefaultFirst(all, "nope")).toBe(all);
  });
});
