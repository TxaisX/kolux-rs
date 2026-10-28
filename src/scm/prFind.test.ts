// Row 76 (T-226 / VIEW-074 / GIT-025): the composer's linked-pull-request lookup, for every provider.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let reply: (cmd: string, args: Record<string, unknown>) => unknown = () => null;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return reply(cmd, args);
  },
}));

import type { Status } from "./model";
import { readReview, reviewKey, reviewLines, reviewSettle, reviewShown, type ReviewFacts } from "./prFind";

const status = { branch: "feat", base: "origin/main", upstream: "origin/feat", upstreamRemote: "origin" } as unknown as Status;
const pr = { number: 12, url: "https://github.com/acme/app/pull/12", state: "OPEN", title: "Add login", head: "feat", draft: false };
const findCalls = () => calls.filter((c) => c.cmd === "scm_pr_find");
const github = (found: unknown, repo: string | null = "github.com/acme/app") => (cmd: string) => (cmd === "scm_pr_find" ? { provider: "github", host: null, pr: found, repo } : null);

describe("row 76 linked pull request lookup in the composer", () => {
  beforeEach(() => {
    calls.length = 0;
    reply = () => null;
  });

  it("a GitHub remote with a linked pull request shows that pull request and where it points", async () => {
    reply = github(pr);
    const f = await readReview("C:/w", status);
    expect(findCalls()).toHaveLength(1);
    expect(findCalls()[0].args).toMatchObject({ worktree: "C:/w", defaultBranch: "main", linked: false, number: null });
    expect(f.lookup).toEqual({ kind: "found", pr, target: "acme/app" });
    expect(reviewLines(f).some((l) => l.includes("#12") && l.includes("Add login"))).toBe(true);
    expect(reviewLines(f).some((l) => l.includes("acme/app"))).toBe(true);
  });

  it("a GitHub remote with no pull request names the repository that was searched", async () => {
    reply = github(null);
    const f = await readReview("C:/w", status);
    expect(f.lookup).toEqual({ kind: "none", repo: "github.com/acme/app" });
    expect(reviewLines(f)).toEqual(["No pull request for this branch in github.com/acme/app."]);
  });

  it("with the user's fork as origin the none answer names the fork, never the upstream it was forked from", async () => {
    reply = github(null, "github.com/me/app");
    const text = reviewLines(await readReview("C:/w", status)).join(" ");
    expect(text).toContain("in github.com/me/app.");
    expect(text).not.toMatch(/acme|yet/);
  });

  it("a none answer without a repository still says where gh looked", async () => {
    reply = github(null, null);
    expect(reviewLines(await readReview("C:/w", status))).toEqual(["No pull request for this branch in origin."]);
  });

  it("a branch pushed to a fork asks with the fork's owner and renamed branch and names the fork", async () => {
    reply = (cmd) => (cmd === "scm_push_target" ? { branch: "feat", remote: "me", remoteBranch: "feat-x", url: "https://github.com/me/app.git", fork: "me/app" } : github(pr)(cmd));
    const f = await readReview("C:/w", status);
    expect(findCalls()[0].args).toMatchObject({ forkOwner: "me", remoteBranch: "feat-x" });
    expect(reviewLines(f).join("\n")).toContain("Pushes to the fork me/app");
    expect(reviewLines(f).join("\n")).toContain("acme/app");
  });

  it("a fork that is not a GitHub address sends no fork owner", async () => {
    reply = (cmd) => (cmd === "scm_push_target" ? { branch: "feat", remote: "me", remoteBranch: "feat", url: "git@gitlab.com:me/app.git", fork: "git@gitlab.com:me/app.git" } : github(null)(cmd));
    await readReview("C:/w", status);
    expect(findCalls()[0].args.forkOwner).toBeNull();
  });

  it("a GitLab remote shows the neutral note, names the host and no pull request", async () => {
    reply = (cmd) => (cmd === "scm_pr_find" ? { provider: "gitlab", host: "gitlab.com", pr: null } : null);
    const f = await readReview("C:/w", status);
    expect(f.lookup).toEqual({ kind: "unsupported", provider: "gitlab", host: "gitlab.com" });
    const text = reviewLines(f).join("\n");
    expect(text).toContain("not available for gitlab.com");
    expect(text).not.toMatch(/No pull request for this branch yet/);
  });

  it("an unknown host and a repository with no remote get the same neutral note", async () => {
    reply = (cmd) => (cmd === "scm_pr_find" ? { provider: "other", host: "code.example.org", pr: null } : null);
    expect(reviewLines(await readReview("C:/w", status)).join("\n")).toContain("not available for code.example.org");
    reply = (cmd) => (cmd === "scm_pr_find" ? { provider: "none", host: null, pr: null } : null);
    expect(reviewLines(await readReview("C:/w", status)).join("\n")).toContain("not available for this repository");
  });

  it("a lookup error becomes a note, not a throw, so starting a pull request stays possible", async () => {
    reply = (cmd) => {
      if (cmd === "scm_pr_find") throw new Error("To authenticate, run gh auth login");
      return null;
    };
    const f = await readReview("C:/w", status);
    expect(f.lookup).toEqual({ kind: "failed", message: "Error: To authenticate, run gh auth login" });
    expect(reviewLines(f).join("\n")).toContain("could not be looked up");
  });

  it("a failing fork read does not stop the lookup", async () => {
    reply = (cmd) => {
      if (cmd === "scm_push_target") throw new Error("boom");
      return github(pr)(cmd);
    };
    expect((await readReview("C:/w", status)).lookup.kind).toBe("found");
  });

  it("a detached head asks nothing", async () => {
    const f = await readReview("C:/w", { ...status, branch: null });
    expect(calls).toHaveLength(0);
    expect(f.lookup).toEqual({ kind: "none", repo: null });
  });

  it("an answer for another worktree or branch is never shown, and a late stale answer does not replace the current one", async () => {
    const a: ReviewFacts = { lookup: { kind: "found", pr, target: null }, push: null };
    const b: ReviewFacts = { lookup: { kind: "none", repo: null }, push: null };
    const keyA = reviewKey("C:/a", "feat");
    const keyB = reviewKey("C:/b", "feat");
    expect(keyA).not.toBe(keyB);
    expect(reviewKey("C:/a", "other")).not.toBe(keyA);
    let slot = reviewSettle(null, keyB, b, keyB); // B answers first
    slot = reviewSettle(slot, keyA, a, keyB); // A's lookup, started before the switch, finishes late
    expect(reviewShown(slot, keyB)).toBe(b);
    expect(reviewShown(slot, keyA)).toBeNull();
  });

  it("makes exactly one lookup per call: no polling", async () => {
    reply = github(null);
    await readReview("C:/w", status);
    expect(findCalls()).toHaveLength(1);
  });
});
