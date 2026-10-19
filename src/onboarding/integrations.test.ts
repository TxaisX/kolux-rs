import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationSteps, readSeen, restale, taskSummary, UNSEEN, type Seen } from "./integrations";

const seen = (o: Partial<Seen>): Seen => ({ account: "octo", token: "ok", tracker: "ok", ...o });

describe("Connect integrations (ONB-018)", () => {
  it("nothing connected: review active, tasks waiting", () => {
    const s = integrationSteps(UNSEEN);
    expect([s.review, s.tasks, s.source]).toEqual(["active", "waiting", null]);
    expect(s.reviewNote).toMatch(/not connected/);
    expect(integrationSteps({ account: null, token: "ok", tracker: "ok" }).review).toBe("active");
  });
  it("connect GitHub: both steps done and GitHub named in the summary", () => {
    const s = integrationSteps(seen({}));
    expect([s.review, s.tasks, s.source]).toEqual(["done", "done", "GitHub"]);
    expect(taskSummary(s, "octo")).toBe("Tasks come from GitHub (octo)");
    expect(taskSummary(integrationSteps(UNSEEN), null)).toBeNull();
  });
  it("a cached sign-in is not connected while its check is stale, pending or failed", () => {
    for (const token of ["stale", "pending", "failed"] as const) {
      const s = integrationSteps(seen({ token }));
      expect([s.review, s.tasks]).toEqual(["active", "waiting"]);
    }
    expect(integrationSteps(seen({ token: "failed" })).reviewNote).toMatch(/did not accept/);
  });
  it("the task step completes only once review is connected and the tracker check has finished", () => {
    expect(integrationSteps(seen({ tracker: "pending" })).tasks).toBe("active");
    expect(integrationSteps(seen({ tracker: "stale" })).tasks).toBe("active");
    const failed = integrationSteps(seen({ tracker: "failed" }));
    expect([failed.review, failed.tasks]).toEqual(["done", "active"]);
    expect(failed.tasksNote).toMatch(/did not answer/);
    expect(integrationSteps(seen({ token: "failed", tracker: "ok" })).tasks).toBe("waiting");
  });
  it("Re-check makes every earlier answer stale until the new one lands", () => {
    expect(restale(seen({}))).toEqual({ account: "octo", token: "stale", tracker: "stale" });
    expect(integrationSteps(restale(seen({}))).review).toBe("active");
    expect(restale(UNSEEN)).toEqual(UNSEEN);
  });
});

// A stand-in gh: a small script run as a real process, answering the two calls Kolux makes the way gh does
// (`gh config get -h github.com user`, `gh api rate_limit`). No real gh, no network, no real sign-in.
// The project has no Node type definitions, so the Node modules are loaded untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proc = (globalThis as any).process;
const SCRIPT = [
  'const [mode, ...args] = process.argv.slice(2);',
  'if (args[0] === "config") {',
  '  if (mode === "out") { process.stderr.write("key not found"); process.exit(1); }',
  '  console.log("octo");',
  '} else if (args[0] === "api") {',
  '  if (mode === "badtoken") { process.stderr.write("HTTP 401: Bad credentials"); process.exit(1); }',
  '  console.log(JSON.stringify({ resources: { core: {}, search: {}, graphql: {} } }));',
  '} else process.exit(2);',
  "",
].join("\n");
let dir = "";
let script = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cp: any;
beforeAll(async () => {
  const [fs, os, path] = await Promise.all([load("node:fs"), load("node:os"), load("node:path")]);
  cp = await load("node:child_process");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "onb018-"));
  script = path.join(dir, "gh.mjs");
  fs.writeFileSync(script, SCRIPT);
});
afterAll(async () => (await load("node:fs")).rmSync(dir, { recursive: true, force: true }));

const standIn = (mode: "in" | "out" | "badtoken") => {
  const run = (args: string[]) => {
    try {
      return { ok: true as const, out: cp.execFileSync(proc.execPath, [script, mode, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
    } catch {
      return { ok: false as const, out: "" };
    }
  };
  // The commands answer as Kolux's Rust side does: scm_gh_account = the config user when gh exits 0, else null;
  // scm_gh_budget = one row per API budget when `gh api` exits 0, else an error.
  return async <T>(cmd: string): Promise<T> => {
    if (cmd === "scm_gh_account") {
      const r = run(["config", "get", "-h", "github.com", "user"]);
      return (r.ok && r.out ? r.out : null) as T;
    }
    const r = run(["api", "rate_limit"]);
    if (!r.ok) throw new Error("gh api failed");
    return Object.keys(JSON.parse(r.out).resources).map((name) => ({ name })) as T;
  };
};

describe("Connect integrations against a stand-in gh (ONB-018)", () => {
  it("signed in with a good token: GitHub is connected and both steps resolve", async () => {
    const s = await readSeen(standIn("in"));
    expect(s).toEqual({ account: "octo", token: "ok", tracker: "ok" });
    expect(integrationSteps(s).tasks).toBe("done");
  });
  it("signed out: nothing is connected, review is active and tasks wait", async () => {
    const s = await readSeen(standIn("out"));
    expect(s.account).toBeNull();
    const st = integrationSteps(s);
    expect([st.review, st.tasks]).toEqual(["active", "waiting"]);
  });
  it("a cached sign-in whose token gh rejects does not count as ready for review", async () => {
    const s = await readSeen(standIn("badtoken"));
    expect(s).toEqual({ account: "octo", token: "failed", tracker: "failed" });
    expect(integrationSteps(s).review).toBe("active");
  });
});
