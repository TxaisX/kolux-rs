// FIX-1 (stand-in review FIX-SOON 4): the pull request page's outward-write rules, proven on the
// page itself. The commands are a mocked invoke that records every call; the page is the real
// component, mounted into the small stand-in DOM in fakeDom.ts and clicked like a user would.
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byLabel, byText, click, type FakeDocument, type FakeNode, installDom, mount, settle, typeInto, until, withText } from "./fakeDom";
import type { PrPageData } from "./prModel";

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  answers: {} as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    const a = h.answers[cmd];
    return Promise.resolve(typeof a === "function" ? (a as (x: Record<string, unknown>) => unknown)(args) : a);
  },
}));

// The only commands that read. Anything else a pull request page sends changes GitHub.
const READS = ["pr_page", "pr_checks", "pr_threads", "pr_files", "github_people"];
const writes = () => h.calls.filter((c) => !READS.includes(c.cmd));
const sent = (cmd: string) => h.calls.filter((c) => c.cmd === cmd);

const page = (over: Partial<PrPageData> = {}): PrPageData => ({
  number: 7,
  title: "Fix the login",
  body: "Closes #3",
  state: "open",
  draft: false,
  url: "https://github.com/acme/app/pull/7",
  author: "ana",
  headRef: "fix-login",
  headSha: "abc1234def",
  baseRef: "main",
  mergeableState: "clean",
  labels: [],
  assignees: [],
  reviewers: [],
  reactions: [],
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  reviewsTruncated: false,
  reviewsLimit: 500,
  ...over,
});
const thread = { id: 100, path: "src/a.ts", line: 4, comments: [{ id: 100, author: "bo", body: "why?", at: "2026-10-01T00:00:00Z" }, { id: 101, author: "ana", body: "because", at: "2026-10-02T00:00:00Z" }] };

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
  h.calls.length = 0;
  h.answers = {
    pr_page: page(),
    pr_checks: [],
    pr_threads: { threads: [thread], truncated: false, limit: 500 },
    pr_files: { files: [{ filename: "src/a.ts", status: "modified", additions: 3, deletions: 1, patch: "@@" }], truncated: false, limit: 500 },
    github_people: [],
    pr_merge: null,
    pr_reply: null,
  };
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open(over: { added?: boolean; host?: string } = {}) {
  const { default: PullRequestPage } = await import("./PullRequestPage");
  const m = await mount(createElement(PullRequestPage, { target: { host: over.host ?? "github.com", repo: "acme/app", number: 7, kind: "pull" }, added: over.added ?? true, onClose: () => {} }), doc);
  unmount = m.unmount;
  await until(() => byText(m.container, "button", "Close pull request").length > 0, "the page to load");
  return m.container as FakeNode;
}
const mergeBox = (c: FakeNode) => c.textContent;

describe("T-232-c the pull request page only writes when told to", () => {
  it("reading the page and switching tabs sends no write command", async () => {
    const c = await open();
    await click(c, withText(c, "button", "Checks")[0]);
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => withText(c, "summary", "src/a.ts").length > 0, "the files");
    await click(c, withText(c, "button", "Conversation")[0]);
    expect(sent("pr_page").length).toBeGreaterThan(0);
    expect(sent("pr_files")).toHaveLength(1);
    expect(writes()).toEqual([]);
  });

  it("every command goes to the pull request's own host", async () => {
    const c = await open({ host: "git.corp.example" });
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => sent("pr_files").length > 0, "the files");
    expect(h.calls.length).toBeGreaterThan(3);
    for (const x of h.calls) expect(x.args.host, x.cmd).toBe("git.corp.example");
  });

  it("merges once, with confirmed true and the head sha the page showed, and only after both clicks", async () => {
    const c = await open();
    expect(sent("pr_merge")).toHaveLength(0);
    await click(c, byText(c, "button", "Merge...")[0]);
    expect(sent("pr_merge")).toHaveLength(0);
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(1);
    await click(c, byText(c, "button", "Yes, merge it")[0]);
    await until(() => sent("pr_merge").length > 0, "the merge");
    expect(sent("pr_merge")).toHaveLength(1);
    expect(sent("pr_merge")[0].args).toEqual({ host: "github.com", repo: "acme/app", number: 7, method: "squash", confirmed: true, sha: "abc1234def" });
  });

  it("a Reload that finds new commits closes the merge confirm, says so, and reads the files again", async () => {
    const c = await open();
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => withText(c, "summary", "src/a.ts").length > 0, "the files");
    expect(sent("pr_files")).toHaveLength(1);
    await click(c, withText(c, "button", "Conversation")[0]);
    await click(c, byText(c, "button", "Merge...")[0]);
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(1);
    // someone pushes: the next read of the page answers a new head commit
    h.answers.pr_page = page({ headSha: "fed9876cba" });
    await click(c, byText(c, "button", "Reload")[0]);
    await until(() => sent("pr_threads").length > 1, "the reload");
    await settle();
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(0);
    expect(mergeBox(c)).toContain("New commits were pushed");
    expect(mergeBox(c)).toContain("check Files changed again");
    // the old diff is gone: opening Files changed asks for the new one
    await click(c, withText(c, "button", "Files changed")[0]);
    await settle();
    expect(sent("pr_files")).toHaveLength(2);
    // and a merge now pins the new head, after both clicks again
    await click(c, withText(c, "button", "Conversation")[0]);
    await click(c, byText(c, "button", "Merge...")[0]);
    await click(c, byText(c, "button", "Yes, merge it")[0]);
    await until(() => sent("pr_merge").length > 0, "the merge");
    expect(sent("pr_merge")[0].args).toMatchObject({ sha: "fed9876cba" });
  });

  it("a Reload on the same head leaves the confirm and the files alone", async () => {
    const c = await open();
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => withText(c, "summary", "src/a.ts").length > 0, "the files");
    await click(c, withText(c, "button", "Conversation")[0]);
    await click(c, byText(c, "button", "Merge...")[0]);
    await click(c, byText(c, "button", "Reload")[0]);
    await until(() => sent("pr_threads").length > 1, "the reload");
    await settle();
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(1);
    expect(mergeBox(c)).not.toContain("New commits were pushed");
    await click(c, withText(c, "button", "Files changed")[0]);
    expect(sent("pr_files")).toHaveLength(1);
  });

  it("Cancel on the confirm step sends nothing and closes it", async () => {
    const c = await open();
    await click(c, byText(c, "button", "Merge...")[0]);
    await click(c, byText(c, "button", "Cancel")[0]);
    expect(sent("pr_merge")).toHaveLength(0);
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(0);
    expect(writes()).toEqual([]);
  });

  it("a reply goes to the thread's root comment, not its last reply", async () => {
    const c = await open();
    await until(() => byText(c, "button", "Reply").length > 0, "the thread");
    await click(c, byText(c, "button", "Reply")[0]);
    await typeInto(c, byLabel(c, "textarea", "Reply")[0], "thanks");
    await click(c, byText(c, "button", "Reply")[0]);
    await until(() => sent("pr_reply").length > 0, "the reply");
    expect(sent("pr_reply")).toHaveLength(1);
    expect(sent("pr_reply")[0].args).toMatchObject({ comment: 100, body: "thanks" });
  });

  it("a repository not added in Kolux gets the page but no merge button, and says why", async () => {
    const c = await open({ added: false });
    expect(mergeBox(c)).toContain("Add this repository in Kolux to merge from here.");
    expect(byText(c, "button", "Merge...")).toHaveLength(0);
  });

  it("a pull request GitHub has not finished checking cannot be merged yet", async () => {
    for (const state of ["unknown", ""]) {
      h.answers.pr_page = page({ mergeableState: state });
      const c = await open();
      expect(mergeBox(c), state).toContain("GitHub is still checking whether it can merge");
      expect(byText(c, "button", "Merge...")).toHaveLength(0);
      await unmount();
      unmount = async () => {};
    }
  });

  it("links go through safeHref, and a markdown link shows where it goes", async () => {
    h.answers.pr_page = page({ url: "javascript:alert(1)", body: "see [https://github.com/x](http://elsewhere.example/y)" });
    h.answers.pr_checks = [{ id: 1, name: "build", status: "completed", conclusion: "success", url: "javascript:alert(2)", runId: 1 }, { id: 2, name: "lint", status: "completed", conclusion: "success", url: "https://ci.example/lint", runId: 2 }];
    const root = await open();
    // no "Open on GitHub" link for an address that is not http(s)
    expect(withText(root, "a", "Open on GitHub")).toHaveLength(0);
    const md = withText(root, "a", "https://github.com/x")[0];
    expect(md.attrs.href).toBe("http://elsewhere.example/y");
    expect(md.attrs.title).toBe("http://elsewhere.example/y");
    await click(root, withText(root, "button", "Checks")[0]);
    await until(() => withText(root, "li", "lint").length > 0, "the checks");
    expect(withText(root, "a", "build")).toHaveLength(0);
    expect(withText(root, "li", "build")).toHaveLength(1);
    expect(withText(root, "a", "lint")[0].attrs.href).toBe("https://ci.example/lint");
  });

  it("says when files, review threads or reviews were cut at the page limit", async () => {
    h.answers.pr_files = { files: [{ filename: "src/a.ts", status: "modified", additions: 3, deletions: 1, patch: "@@" }], truncated: true, limit: 250 };
    h.answers.pr_threads = { threads: [thread], truncated: true, limit: 250 };
    h.answers.pr_page = page({ reviewsTruncated: true, reviewsLimit: 250 });
    const c = await open();
    expect(mergeBox(c)).toContain("Showing the first 250 review comments");
    expect(mergeBox(c)).toContain("Showing the first 250 reviews");
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => withText(c, "summary", "src/a.ts").length > 0, "the files");
    expect(mergeBox(c)).toContain("Showing the first 250 files");
  });
});
