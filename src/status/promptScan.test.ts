import { describe, expect, it } from "vitest";
import { promptScanner } from "./promptScan";

const recorder = () => {
  const calls: string[] = [];
  const call = async (cmd: string, args: Record<string, unknown>) => {
    calls.push(`${cmd} ${JSON.stringify(args)}`);
    return null;
  };
  return { calls, call };
};

describe("row 219: the window scans panes for open prompts (ORCH-056)", () => {
  it("scans every pane with a live terminal, each pass", async () => {
    const { calls, call } = recorder();
    const scan = promptScanner(call);
    await scan.pass({ 1: 10, 2: 20 }, new Set());
    await scan.pass({ 1: 10, 2: 20 }, new Set());
    expect(calls).toEqual([
      'prompt_scan {"paneKey":1,"terminal":10}',
      'prompt_scan {"paneKey":2,"terminal":20}',
      'prompt_scan {"paneKey":1,"terminal":10}',
      'prompt_scan {"paneKey":2,"terminal":20}',
    ]);
  });

  it("a restored pane marks its old output once before its first scan, and again on a new terminal", async () => {
    const { calls, call } = recorder();
    const scan = promptScanner(call);
    await scan.pass({ 3: 30 }, new Set([3]));
    await scan.pass({ 3: 30 }, new Set([3]));
    await scan.pass({ 3: 31 }, new Set([3]));
    expect(calls).toEqual([
      'prompt_scan_restored {"terminal":30}',
      'prompt_scan {"paneKey":3,"terminal":30}',
      'prompt_scan {"paneKey":3,"terminal":30}',
      'prompt_scan_restored {"terminal":31}',
      'prompt_scan {"paneKey":3,"terminal":31}',
    ]);
  });

  it("a pane that is not restored never skips its first output", async () => {
    const { calls, call } = recorder();
    await promptScanner(call).pass({ 4: 40 }, new Set([9]));
    expect(calls).toEqual(['prompt_scan {"paneKey":4,"terminal":40}']);
  });

  it("an ended terminal drops its scan memory", async () => {
    const { calls, call } = recorder();
    const scan = promptScanner(call);
    await scan.pass({ 5: 50 }, new Set([5]));
    await scan.ended(50);
    await scan.pass({ 5: 50 }, new Set([5]));
    expect(calls).toEqual([
      'prompt_scan_restored {"terminal":50}',
      'prompt_scan {"paneKey":5,"terminal":50}',
      'prompt_scan_pruned {"terminal":50}',
      'prompt_scan_restored {"terminal":50}',
      'prompt_scan {"paneKey":5,"terminal":50}',
    ]);
  });

  it("a pass still running skips the next, and a failing call does not stop the pass", async () => {
    let release: () => void = () => undefined;
    const calls: string[] = [];
    const call = (cmd: string, args: Record<string, unknown>) => {
      calls.push(`${cmd} ${JSON.stringify(args)}`);
      if (args.terminal === 60) return new Promise((done) => (release = () => done(null)));
      return Promise.reject(new Error("no such terminal"));
    };
    const scan = promptScanner(call);
    const first = scan.pass({ 6: 60, 7: 70 }, new Set());
    expect(await scan.pass({ 6: 60, 7: 70 }, new Set())).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(calls).toEqual(['prompt_scan {"paneKey":6,"terminal":60}', 'prompt_scan {"paneKey":7,"terminal":70}']);
  });
});
