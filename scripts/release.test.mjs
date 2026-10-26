import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquire, downloadUrl, isStale, manifest, markerOf, newestTag, nextVersion, notesBody, smokeCli, smokeMigration, takeQueued, unlock, STALE_MS } from "./release.mjs";
import { decide, WAIT_MS } from "./ci-gate.mjs";
import { checkPromises, checkWorkflow } from "./workflow-check.mjs";
import { parseArgs } from "./ship.mjs";

describe("release version (APP-059)", () => {
  it("is one patch above the higher of the project version and the newest release", () => {
    expect(nextVersion("0.1.0", null)).toBe("0.1.1");
    expect(nextVersion("0.1.0", "v0.1.7")).toBe("0.1.8");
    expect(nextVersion("0.3.0", "v0.2.9")).toBe("0.3.1"); // a version-bump commit wins
    expect(() => nextVersion("one", null)).toThrow(/x\.y\.z/);
  });
  it("picks the newest rehearsal folder by number, not by text", () => {
    expect(newestTag(["v0.1.9", "v0.1.10", "latest.json", "v0.1.2"])).toBe("v0.1.10");
    expect(newestTag(["latest.json"])).toBeNull();
  });
});

describe("release notes (APP-059)", () => {
  it("list each commit subject, 30 at most, with the source marker hidden at the end", () => {
    const subjects = Array.from({ length: 40 }, (_, i) => `Change ${i + 1}`);
    const body = notesBody([...subjects, ""], "abc1234def");
    expect(body.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(30);
    expect(body.startsWith("- Change 1\n")).toBe(true);
    expect(markerOf(body)).toBe("abc1234def");
    expect(markerOf("no marker")).toBeNull();
  });
  it("the manifest is the updater's signed JSON with the GitHub download address", () => {
    const m = manifest("0.1.1", "- x", "sig", downloadUrl("0.1.1"), new Date("2026-10-09T00:00:00Z"));
    expect(m.platforms["windows-x86_64"].url).toBe("https://github.com/TxaisX/kolux-rs-releases/releases/download/v0.1.1/Kolux%20RS_0.1.1_x64-setup.exe");
    expect(m.pub_date).toBe("2026-10-09T00:00:00.000Z");
  });
});

describe("one build at a time (APP-059)", () => {
  it("a lock older than three hours or held by a dead process is stale", () => {
    const now = 10 * STALE_MS;
    expect(isStale({ pid: 1, at: now - 1000 }, now, () => true)).toBe(false);
    expect(isStale({ pid: 1, at: now - STALE_MS - 1 }, now, () => true)).toBe(true);
    expect(isStale({ pid: 1, at: now }, now, () => false)).toBe(true);
    expect(isStale(null, now, () => true)).toBe(true);
  });
  it("a second job queues exactly one more build; a stale lock is taken over", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "krs-rel-")), "checkout");
    expect(acquire(dir, { pid: 1, isAlive: () => true })).toBe("locked");
    expect(acquire(dir, { pid: 2, isAlive: () => true })).toBe("queued");
    expect(acquire(dir, { pid: 3, isAlive: () => true })).toBe("queued");
    expect(takeQueued(dir)).toBe(true);
    expect(takeQueued(dir)).toBe(false); // three ships, one extra build
    expect(acquire(dir, { pid: 4, isAlive: () => false })).toBe("locked"); // holder died
    unlock(dir);
    expect(fs.existsSync(dir + ".lock")).toBe(false);
  });
});

describe("packaged CLI smoke test (APP-061)", () => {
  const cli = (version, help) => (words) => (words[0] === "--version" ? version : help);
  const HELP = ["kolux: drive Kolux from a terminal", "  kolux --version", "  kolux worktree create --name <name>"].join(String.fromCharCode(10));
  it("passes a CLI that reports the release version and prints its help", () => {
    expect(() => smokeCli(cli("0.2.0", HELP), "0.2.0")).not.toThrow();
  });
  it("stops the release when the CLI's version is wrong or its help is broken", () => {
    expect(() => smokeCli(cli("0.1.9", HELP), "0.2.0")).toThrow(/says 0.1.9, the release is 0.2.0/);
    expect(() => smokeCli(cli("0.2.0", ""), "0.2.0")).toThrow(/--help/);
  });
});

describe("packaged old-profile migration smoke test (APP-061)", () => {
  const fake = (added, seen = []) => (words, env) => {
    seen.push({ words, env });
    return JSON.stringify({ success: true, result: { added } });
  };
  const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "mig-smoke-"));
  it("lays out a former-name folder beside a throwaway profile and passes when exactly the listed settings carried", () => {
    const root = scratch();
    const seen = [];
    smokeMigration(fake(["uiLook", "language"], seen), root);
    expect(seen[0].words).toEqual(["profile", "migrate", "--json"]);
    expect(seen[0].env.KOLUX_USER_DATA_PATH).toBe(path.join(root, "kolux.smoke"));
    expect(fs.readFileSync(path.join(root, "Nightshift", "settings.json"), "utf8")).toMatch(/nightshiftLanguage/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("stops the release when a setting is missing or one beyond the allow-list carried", () => {
    const root = scratch();
    expect(() => smokeMigration(fake(["uiLook"]), root)).toThrow(/carried \["uiLook"\]/);
    expect(() => smokeMigration(fake(["uiLook", "language", "githubToken"]), root)).toThrow(/more than the allow-list/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("CI gate (APP-060)", () => {
  const sha = "0123456789abcdef";
  it("passes only a green run for that commit", () => {
    expect(decide([{ status: "completed", conclusion: "success" }], sha, 0).verdict).toBe("pass");
    const r = decide([{ status: "completed", conclusion: "failure", url: "u" }], sha, 0);
    expect(r.verdict).toBe("refuse");
    expect(r.reason).toMatch(/0123456 ended "failure".*not published/);
  });
  it("waits up to 30 minutes for a queued or missing run, then refuses with the reason", () => {
    expect(decide([{ status: "queued" }], sha, WAIT_MS - 1).verdict).toBe("wait");
    expect(decide([], sha, 0).verdict).toBe("wait");
    expect(decide([{ status: "in_progress" }], sha, WAIT_MS).reason).toMatch(/still in_progress after 30 minutes/);
    expect(decide([], sha, WAIT_MS).verdict).toBe("refuse");
  });
});

describe("workflow check", () => {
  it("finds schema mistakes", () => {
    const bad = "name: x\non: [push]\njobs:\n  a:\n    needs: b\n    runs-on: ubuntu-latest\n    stepz: []\n";
    const errs = checkWorkflow(bad, "bad.yml");
    expect(errs.join("\n")).toMatch(/needs "b"/);
    expect(errs.join("\n")).toMatch(/unknown key "stepz"/);
    expect(checkWorkflow("name: [", "b.yml")[0]).toMatch(/not valid YAML/);
  });
  it("holds the shipped workflows to the four-shard and gate promises", () => {
    expect(checkPromises({ "ci.yml": { on: { push: {} }, jobs: { test: { strategy: { matrix: { shard: [1, 2] } } } } } }).join("\n")).toMatch(/shards 1, 2, 3 and 4/);
    const rel = { jobs: { r: { steps: [{ run: "node scripts/release.mjs" }, { run: "node scripts/ci-gate.mjs x" }] } } };
    expect(checkPromises({ "release.yml": rel }).join("\n")).toMatch(/gate must come before/);
  });
});

describe("ship options (APP-058)", () => {
  it("reads the 0.15.0 options", () => {
    const o = parseArgs(["--main", "--no-release", "--merge", "feat", "--dry-run", "--model", "sonnet", "--message", "Bump to 0.2.0"]);
    expect(o).toMatchObject({ main: true, release: false, merge: "feat", dryRun: true, model: "sonnet", message: "Bump to 0.2.0" });
    expect(parseArgs([]).model).toBe("haiku");
    expect(() => parseArgs(["--merge"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--model", "x & del"])).toThrow(/not a model id/);
    expect(() => parseArgs(["--rebase"])).toThrow(/unknown option/);
  });
});
