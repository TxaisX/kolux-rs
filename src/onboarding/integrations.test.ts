import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSeenReader, integrationSteps, readSeen, restale, SEEN_FRESH_MS, taskSourceOf, taskSummary, UNSEEN, type Row, type Seen } from "./integrations";

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
  '  if (mode === "offline") { process.stderr.write("error connecting to api.github.com"); process.exit(1); }',
  '  if (mode === "empty") { console.log(JSON.stringify({ resources: { core: {}, search: {}, graphql: {} } })); process.exit(0); }',
  // The shape gh prints for `gh api rate_limit`: a numeric limit, remaining and reset per budget.
  '  const b = (limit, remaining) => ({ limit, remaining, used: limit - remaining, reset: 1900000000 });',
  '  console.log(JSON.stringify({ resources: { core: b(5000, 4990), graphql: b(5000, 5000), search: b(30, 30) }, rate: b(5000, 4990) }));',
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

const standIn = (mode: "in" | "out" | "badtoken" | "offline" | "empty") => {
  const run = (args: string[]) => {
    try {
      return { ok: true as const, out: cp.execFileSync(proc.execPath, [script, mode, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), err: "" };
    } catch (e) {
      return { ok: false as const, out: "", err: String((e as { stderr?: unknown }).stderr ?? "") };
    }
  };
  // The commands answer as Kolux's Rust side does (scm.rs gh_budget): scm_gh_account = the config user when gh
  // exits 0, else null; scm_gh_budget = a row ("REST", "Search", "GraphQL") for each budget that has a numeric
  // limit, remaining and reset, a budget missing any of them dropped, or gh's own words as the error.
  return async <T>(cmd: string): Promise<T> => {
    if (cmd === "scm_gh_account") {
      const r = run(["config", "get", "-h", "github.com", "user"]);
      return (r.ok && r.out ? r.out : null) as T;
    }
    const r = run(["api", "rate_limit"]);
    if (!r.ok) throw new Error(r.err);
    const res = JSON.parse(r.out).resources as Record<string, Record<string, unknown>>;
    const rows = ([["core", "REST"], ["search", "Search"], ["graphql", "GraphQL"]] as const).flatMap(([key, name]) => {
      const b = res[key] ?? {};
      return ["limit", "remaining", "reset"].every((f) => Number.isInteger(b[f])) ? [{ name, limit: b.limit, remaining: b.remaining, reset: b.reset }] : [];
    });
    return rows as T;
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
  it("a gh whose answer carries no numeric budgets reads as failed, as the real Rust side would drop them (FIX-1)", async () => {
    const s = await readSeen(standIn("empty"));
    expect(s).toEqual({ account: "octo", token: "failed", tracker: "failed" });
  });
  it("the Explore tasks and PR stops follow the same rule: a revoked token is not connected, an unread answer is null (FIX-1)", async () => {
    expect(taskSourceOf(await readSeen(standIn("badtoken")))).toBe(false);
    expect(taskSourceOf(await readSeen(standIn("out")))).toBe(false);
    expect(taskSourceOf(await readSeen(standIn("in")))).toBe(true);
    expect(taskSourceOf(null)).toBeNull();
    // a cached sign-in alone, or an answer from before a Re-check, is not connected
    expect(taskSourceOf({ account: "octo", token: "pending", tracker: "pending" })).toBe(false);
    expect(taskSourceOf(restale(seen({})))).toBe(false);
  });
});

describe("the sign-in check is remembered for about a minute (FIX-1)", () => {
  const rows: Row[] = [{ name: "REST" }, { name: "Search" }, { name: "GraphQL" }];
  // A counting stand-in for the two commands; `budget` decides each budget call's answer.
  const host = (budget: () => Row[] | string) => {
    const n = { account: 0, budget: 0 };
    const call = async <T>(cmd: string): Promise<T> => {
      if (cmd === "scm_gh_account") return (n.account++, "octo") as T;
      n.budget++;
      const a = budget();
      if (typeof a === "string") throw new Error(a);
      return a as T;
    };
    return { n, call };
  };
  const clock = (t = 1_000_000) => ({ now: () => t, tick: (ms: number) => void (t += ms) });
  const good: Seen = { account: "octo", token: "ok", tracker: "ok" };

  it("reads within the minute answer from memory and do not run gh again", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    const gh = host(() => rows);
    expect(await read(gh.call)).toEqual(good);
    t.tick(SEEN_FRESH_MS - 1);
    expect(await read(gh.call)).toEqual(good);
    expect(gh.n).toEqual({ account: 1, budget: 1 });
    t.tick(2);
    expect(await read(gh.call)).toEqual(good);
    expect(gh.n).toEqual({ account: 2, budget: 2 });
  });
  it("Re-check (force) always asks again", async () => {
    const read = createSeenReader(clock().now);
    const gh = host(() => rows);
    await read(gh.call);
    await read(gh.call, { force: true });
    expect(gh.n.budget).toBe(2);
  });
  it("a re-read that fails on the network keeps the last good answer", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let said: Row[] | string = rows;
    const gh = host(() => said);
    expect(await read(gh.call)).toEqual(good);
    said = "error connecting to api.github.com";
    t.tick(SEEN_FRESH_MS + 1);
    expect(await read(gh.call)).toEqual(good);
    // with no good answer to fall back on, a network failure reads as not connected and is not remembered
    const cold = createSeenReader(t.now);
    expect(await cold(gh.call)).toEqual({ account: "octo", token: "failed", tracker: "failed" });
    said = rows;
    expect(await cold(gh.call)).toEqual(good);
  });
  it("a token gh rejects is not kept: the sign-in reads as failed at once, and signing out is seen on the next read", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let said: Row[] | string = rows;
    const gh = host(() => said);
    await read(gh.call);
    said = "HTTP 401: Bad credentials";
    t.tick(SEEN_FRESH_MS + 1);
    expect(await read(gh.call)).toEqual({ account: "octo", token: "failed", tracker: "failed" });
    const out = async <T>(cmd: string): Promise<T> => (cmd === "scm_gh_account" ? (null as T) : Promise.reject(new Error("never asked")));
    t.tick(SEEN_FRESH_MS + 1);
    expect(await read(out)).toEqual({ account: null, token: "pending", tracker: "pending" });
  });
  it("a Re-check that fails on the network says so rather than hiding it behind the last good answer", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let said: Row[] | string = rows;
    const gh = host(() => said);
    await read(gh.call);
    said = "error connecting to api.github.com";
    expect(await read(gh.call, { force: true })).toEqual({ account: "octo", token: "failed", tracker: "failed" });
  });
});
