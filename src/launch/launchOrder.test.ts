// SESS-026 (T-150): setup settles (asked, opened or visibly failed), then hook trust, then the
// agents; a project that asks about setup for each workspace is refused before anything starts.
import { expect, test } from "vitest";
import { bulkRefusal, DEFAULT_SETUP_MODE, launchInOrder, settleSetups, setupMode, type LaunchSteps } from "./launchOrder";
import type { SetupLine } from "../projects/model";

const LINE: SetupLine = { program: "sh", args: ["-c", "make"], script: "make" };

/** A fake launch that writes every step to `log`; the trust question for `untrusted` dirs is
 *  answered by `answer` ("run" or "skip"), and setup for `broken` dirs throws. */
function fake(opts: { untrusted?: string[]; answer?: "run" | "skip"; broken?: string[]; noScript?: string[] } = {}) {
  const log: string[] = [];
  const ends: Record<string, () => void> = {};
  const steps: LaunchSteps<string> = {
    line: async (dir) => {
      if (opts.broken?.includes(dir)) throw new Error("cmd would misread this script.");
      if (opts.noScript?.includes(dir)) return null;
      if (opts.untrusted?.includes(dir)) {
        log.push(`ask ${dir}`);
        if (opts.answer === "skip") return null;
      }
      return LINE;
    },
    open: (dir, _branch, _line, where) => {
      log.push(`setup ${dir} ${where}`);
      return new Promise<void>((done) => (ends[dir] = () => (log.push(`setup ended ${dir}`), done())));
    },
    say: (m) => log.push(`say ${m}`),
    trustHooks: async () => void log.push("hook trust"),
    start: async () => (log.push("agents start"), "started"),
  };
  return { log, ends, steps };
}

const two = [
  { cwd: "C:\\w\\one", branch: "one" },
  { cwd: "C:\\w\\two", branch: "two" },
];

test("SESS-026: two seats in an untrusted project are asked about setup before any agent starts", async () => {
  const { log, steps } = fake({ untrusted: ["C:\\w\\one", "C:\\w\\two"], answer: "run" });
  expect(await launchInOrder(two, "tab", false, steps)).toBe("started");
  expect(log).toEqual(["ask C:\\w\\one", "setup C:\\w\\one tab", "ask C:\\w\\two", "setup C:\\w\\two tab", "hook trust", "agents start"]);
});

test("SESS-026: Don't run still lets the agents start, after the question and the hook trust", async () => {
  const { log, steps } = fake({ untrusted: ["C:\\w\\one", "C:\\w\\two"], answer: "skip" });
  await launchInOrder(two, "tab", false, steps);
  expect(log).toEqual(["ask C:\\w\\one", "ask C:\\w\\two", "hook trust", "agents start"]);
});

test("SESS-026: a setup that cannot start is said, and the launch goes on in order", async () => {
  const { log, steps } = fake({ broken: ["C:\\w\\one"] });
  await launchInOrder(two, "tab", false, steps);
  expect(log[0]).toBe("say Setup for one did not run (cmd would misread this script); its agent starts without it.");
  expect(log.slice(1)).toEqual(["setup C:\\w\\two tab", "hook trust", "agents start"]);
});

test("SESS-026: with wait on (new tab), the agents start only after the script ends", async () => {
  const { log, ends, steps } = fake();
  const run = launchInOrder([two[0]], "tab", true, steps);
  await new Promise((r) => setTimeout(r, 0));
  expect(log).toEqual(["setup C:\\w\\one tab"]);
  ends["C:\\w\\one"]();
  await run;
  expect(log).toEqual(["setup C:\\w\\one tab", "setup ended C:\\w\\one", "hook trust", "agents start"]);
});

test("SESS-026: wait only holds in new-tab mode; a split setup lets the agents start at once", async () => {
  const { log, steps } = fake();
  await launchInOrder([two[0]], "right", true, steps);
  expect(log).toEqual(["setup C:\\w\\one right", "hook trust", "agents start"]);
});

test("SESS-026: seats sharing one new workspace set it up once; no script opens no setup", async () => {
  const { log, steps } = fake({ noScript: ["C:\\w\\two"] });
  const out = await settleSetups([two[0], two[0], two[1]], "tab", false, steps);
  expect(log).toEqual(["setup C:\\w\\one tab"]);
  expect(out).toEqual([
    { dir: "C:\\w\\one", ran: true },
    { dir: "C:\\w\\two", ran: false },
  ]);
});

test("SESS-026: the setup mode is a new tab by default and for anything unknown", () => {
  expect(DEFAULT_SETUP_MODE).toBe("tab");
  expect([setupMode(undefined), setupMode(null), setupMode("popup"), setupMode(3)]).toEqual(["tab", "tab", "tab", "tab"]);
  expect([setupMode("right"), setupMode("down"), setupMode("ask")]).toEqual(["right", "down", "ask"]);
});

test("SESS-026: a bulk launch that makes workspaces in an ask-each-time project is refused with the reason", () => {
  const why = bulkRefusal("shop", "ask", true);
  expect(why).toContain("shop asks about setup for each new workspace, so it cannot be bulk-launched; nothing was started");
  expect(why).toContain("Settings > Repositories");
  expect(bulkRefusal("shop", "ask", false)).toBeNull(); // seats in an existing workspace run no setup
  expect(bulkRefusal("shop", "tab", true)).toBeNull();
  expect(bulkRefusal("shop", "down", true)).toBeNull();
});

// AFTER row 369: the New workspace dialog starts its setup-where choice at the repository's own mode.
test("the dialog's setup-where starts at the repository's mode; ask and unknown start at a tab", async () => {
  const { dialogWhere } = await import("./launchOrder");
  expect(dialogWhere("right")).toBe("right");
  expect(dialogWhere("down")).toBe("down");
  expect(dialogWhere("tab")).toBe("tab");
  expect(dialogWhere("ask")).toBe("tab");
  expect(dialogWhere(setupMode("sideways"))).toBe("tab");
});
