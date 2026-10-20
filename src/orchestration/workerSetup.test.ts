import { describe, expect, it } from "vitest";
import type { TrustAnswer, TrustAsk } from "../setup/TrustPrompt";
import { gatedSetup, settleSetup, setupRequestOf } from "./workerSetup";

const ASK: TrustAsk = { kind: "setup", script: "pnpm install", changed: false, project: "web" };
const LINE = { program: "sh", args: ["-c", "pnpm install"], script: "pnpm install" };

/** A fake Rust: `need` is script_trust_needed's answer, `line` workspace_setup's; calls are recorded. */
function rust(need: TrustAsk | null, line: typeof LINE | null = LINE, fail = false) {
  const calls: [string, Record<string, unknown>][] = [];
  const invoke = async <T,>(cmd: string, args: Record<string, unknown>): Promise<T> => {
    calls.push([cmd, args]);
    if (fail && cmd === "workspace_setup") throw new Error("no shell");
    if (cmd === "script_trust_needed") return need as T;
    if (cmd === "workspace_setup") return line as T;
    if (cmd === "worker_setup_settled") return true as T;
    return null as T;
  };
  return { calls, invoke, names: () => calls.map(([c]) => c) };
}
const answer = (a: TrustAnswer) => async () => a;

describe("ORCH-017 (T-172-d) a worker start's setup runs in the window, once, behind the trust question", () => {
  it("a trusted script runs once and its exit code is what is reported", async () => {
    const r = rust(ASK);
    const runs: string[] = [];
    const got = await gatedSetup("C:/w/a", async (l) => (runs.push(l.script), 3), r.invoke, answer("once"));
    expect(got).toEqual({ result: "ran", exitCode: 3 });
    expect(runs).toEqual(["pnpm install"]);
    expect(r.names()).toEqual(["script_trust_needed", "script_trust_grant", "workspace_setup"]);
  });

  it("Don't run never starts the script and says declined", async () => {
    const r = rust(ASK);
    let ran = false;
    expect(await gatedSetup("C:/w/a", async () => ((ran = true), 0), r.invoke, answer("skip"))).toEqual({ result: "declined" });
    expect(ran).toBe(false);
    expect(r.names()).not.toContain("workspace_setup");
  });

  it("a project without a setup script says none; one that cannot start says error", async () => {
    expect(await gatedSetup("C:/w/a", async () => 0, rust(null, null).invoke, answer("once"))).toEqual({ result: "none" });
    expect(await gatedSetup("C:/w/a", async () => 0, rust(null, LINE, true).invoke, answer("once"))).toEqual({ result: "error", message: "Error: no shell" });
  });

  it("the answer goes back under the notice's request id", async () => {
    expect(setupRequestOf({ kind: "created", setupRequest: "dispatch-4" })).toBe("dispatch-4");
    expect(setupRequestOf({ kind: "created", setupRequest: null })).toBeNull();
    expect(setupRequestOf({ kind: "created" })).toBeNull();
    const r = rust(null);
    expect(await settleSetup("dispatch-4", { result: "ran", exitCode: 2 }, r.invoke)).toBe(true);
    await settleSetup("dispatch-5", { result: "error", message: "no shell" }, r.invoke);
    expect(r.calls).toEqual([
      ["worker_setup_settled", { request: "dispatch-4", result: "ran", exitCode: 2, message: null }],
      ["worker_setup_settled", { request: "dispatch-5", result: "error", exitCode: null, message: "no shell" }],
    ]);
  });
});
