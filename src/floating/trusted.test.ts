import { expect, test } from "vitest";
import { NOT_PICKED, startFolderFor } from "./trusted";

type Call = { cmd: string; args?: Record<string, unknown> };

function fake(answers: Record<string, (args?: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const call = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ cmd, args });
    const a = answers[cmd];
    if (!a) throw new Error(`unexpected ${cmd}`);
    return a(args) as T;
  };
  return { call, calls };
}

const refuse = (msg: string) => () => {
  throw msg;
};

test("a trusted folder from Rust is where the floating terminal starts (SAFE-027)", async () => {
  const f = fake({ floating_start: () => "C:/work" });
  expect(await startFolderFor(f.call)).toEqual({ cwd: "C:/work" });
  expect(f.calls).toEqual([{ cmd: "floating_start", args: { asked: null } }]);
});

test("with no folder trusted yet the system picker is offered once, and its folder is used (SAFE-027)", async () => {
  const f = fake({ floating_start: refuse("Pick a folder for the floating workspace first."), floating_pick: () => "D:/picked" });
  expect(await startFolderFor(f.call)).toEqual({ cwd: "D:/picked" });
  expect(f.calls.map((c) => c.cmd)).toEqual(["floating_start", "floating_pick"]);
});

test("a cancelled picker, a failed picker and a refused asked folder all open nothing (SAFE-027)", async () => {
  const cancel = fake({ floating_start: refuse("none"), floating_pick: () => null });
  expect(await startFolderFor(cancel.call)).toEqual({ refused: NOT_PICKED });
  const broken = fake({ floating_start: refuse("none"), floating_pick: refuse("dialog failed") });
  expect(await startFolderFor(broken.call)).toEqual({ refused: "dialog failed" });
  // An asked folder Rust refuses is never swapped for a picker or another folder.
  const asked = fake({ floating_start: refuse("C:/x is not a folder you picked for the floating workspace."), floating_pick: () => "D:/picked" });
  expect(await startFolderFor(asked.call, "C:/x")).toEqual({ refused: "C:/x is not a folder you picked for the floating workspace." });
  expect(asked.calls.map((c) => c.cmd)).toEqual(["floating_start"]);
});

test("the interface never sends a list of folders to trust (SAFE-027)", async () => {
  const f = fake({ floating_start: refuse("none"), floating_pick: () => "D:/picked" });
  await startFolderFor(f.call, null);
  for (const c of f.calls) for (const v of Object.values(c.args ?? {})) expect(Array.isArray(v)).toBe(false);
  expect(f.calls.find((c) => c.cmd === "floating_pick")?.args).toBeUndefined();
});
