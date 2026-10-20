import { describe, expect, it } from "vitest";
import type { Task, TaskPage } from "./model";
import { byHost, chosenRows, hostWarnings, mergePages, newIssueTargets, pickerLabel, pickerRows, repoAdded, repoWarnings, rowKey, savedChoice, toggled } from "./repoPicker";

const p = (id: string, path = `C:/dev/${id}`) => ({ id, name: id, path });
const gh = (owner: string, name: string, host = "github.com") => ({ host, owner, name });

describe("GIT-043 the repository picker rows", () => {
  it("folds checkouts of one GitHub project into one row, leaves out projects with no GitHub remote and keeps ones still being checked", () => {
    const projects = [p("app"), p("app-copy"), p("notes"), p("other"), p("slow")];
    const rows = pickerRows(projects, {
      "C:/dev/app": gh("Acme", "app"),
      "C:/dev/app-copy": gh("acme", "APP"),
      "C:/dev/notes": null,
      "C:/dev/other": gh("zed", "tool"),
      "C:/dev/slow": undefined,
    });
    expect(rows.map((r) => [r.label, r.checking, r.projects.map((x) => x.id)])).toEqual([
      ["Acme/app", false, ["app", "app-copy"]],
      ["zed/tool", false, ["other"]],
      ["slow", true, ["slow"]],
    ]);
    expect(rows[0].key).toBe(rowKey(gh("acme", "app")));
  });
  it("tells the same repository name on two hosts apart", () => {
    const rows = pickerRows([p("a"), p("b")], { "C:/dev/a": gh("acme", "app"), "C:/dev/b": gh("acme", "app", "git.corp.example") });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.host).sort()).toEqual(["git.corp.example", "github.com"]);
  });
});

describe("the remembered choice", () => {
  const rows = pickerRows([p("a"), p("b"), p("c")], { "C:/dev/a": gh("o", "a"), "C:/dev/b": gh("o", "b"), "C:/dev/c": undefined });
  it("keeps the saved rows in the order chosen and drops ones that are gone", () => {
    expect(chosenRows(rows, ["github.com/o/b", "github.com/o/gone", "github.com/o/a"], null).map((r) => r.label)).toEqual(["o/b", "o/a"]);
  });
  it("falls back to the checkout on screen, then the first row; a row still being checked is never chosen", () => {
    expect(chosenRows(rows, [], "github.com/o/b").map((r) => r.label)).toEqual(["o/b"]);
    expect(chosenRows(rows, ["github.com/o/gone"], "github.com/o/missing").map((r) => r.label)).toEqual(["o/a"]);
    expect(chosenRows(rows, [rows[2].key], null).map((r) => r.label)).toEqual(["o/a"]);
    expect(chosenRows([], [], null)).toEqual([]);
  });
  it("reads only strings back from settings", () => {
    expect(savedChoice(["a", 3, "a", null, "b"])).toEqual(["a", "b"]);
    expect(savedChoice("a")).toEqual([]);
    expect(savedChoice(undefined)).toEqual([]);
  });
  it("adds and removes a row, but never removes the last one", () => {
    expect(toggled(["a"], "b")).toEqual(["a", "b"]);
    expect(toggled(["a", "b"], "a")).toEqual(["b"]);
    expect(toggled(["a"], "a")).toEqual(["a"]);
  });
});

describe("the picker label, hosts and new issue target", () => {
  const rows = pickerRows([p("a"), p("b"), p("c")], { "C:/dev/a": gh("o", "a"), "C:/dev/b": gh("o", "b", "git.corp.example"), "C:/dev/c": gh("o", "c") });
  const by = (label: string) => rows.find((r) => r.label === label)!;
  it("shows the repository, or a count when several are chosen", () => {
    expect(pickerLabel([])).toBe("No repository");
    expect(pickerLabel([by("o/a")])).toBe("o/a");
    expect(pickerLabel([by("o/a"), by("o/b")])).toBe("2 repositories");
  });
  it("groups the chosen repositories by host, in the order first chosen", () => {
    expect(byHost([by("o/b"), by("o/a"), by("o/c")])).toEqual([
      { host: "git.corp.example", repos: ["o/b"] },
      { host: "github.com", repos: ["o/a", "o/c"] },
    ]);
  });
  it("aims a new issue at the first chosen repository, then the others on its host", () => {
    expect(newIssueTargets([by("o/c"), by("o/b"), by("o/a")])).toEqual(["o/c", "o/a"]);
    expect(newIssueTargets([by("o/a")], "up/stream")).toEqual(["up/stream", "o/a"]);
    expect(newIssueTargets([])).toEqual([]);
  });
});

describe("several hosts in one list", () => {
  const t = (n: number, updated: string): Task => ({ kind: "issue", number: n, title: `t${n}`, url: `u${n}`, repo: "o/a", state: "open", draft: false, labels: [], assignees: [], updated, checks: null });
  const page = (total: number, deepest: number, ...items: Task[]): TaskPage => ({ total, deepest, items });
  it("merges newest first and adds the totals", () => {
    const m = mergePages([page(10, 10, t(1, "2026-10-01"), t(2, "2026-10-05")), page(7, 30, t(3, "2026-10-03"))]);
    expect(m.items.map((i) => i.number)).toEqual([2, 3, 1]);
    expect([m.total, m.deepest]).toEqual([17, 30]);
    const one = page(1, 1, t(1, "x"));
    expect(mergePages([one])).toBe(one);
  });
  it("stamps every row with the host that answered, so two hosts with the same repository name stay apart", () => {
    const m = mergePages([page(1, 1, t(1, "2026-10-01")), page(1, 1, t(1, "2026-10-02"))], ["github.com", "git.corp.example"]);
    expect(m.items.map((i) => [i.number, i.host])).toEqual([[1, "git.corp.example"], [1, "github.com"]]);
    // one host: still stamped, and the page is not shared with the caller
    const one = page(1, 1, t(5, "x"));
    expect(mergePages([one], ["git.corp.example"]).items[0].host).toBe("git.corp.example");
    expect(one.items[0].host).toBeUndefined();
  });
  it("knows which repositories are added in Kolux (a project with a checkout), per host", () => {
    const row = (host: string, repo: string, projects: number) => ({ key: `${host}/${repo}`, host, repo, checking: false, label: repo, projects: Array.from({ length: projects }, (_, i) => p(`p${i}`)) });
    const rows = [row("github.com", "acme/app", 1), row("git.corp.example", "acme/tool", 0), { ...row("", "", 1), checking: true }];
    expect(repoAdded(rows, "github.com", "Acme/App")).toBe(true);
    expect(repoAdded(rows, "git.corp.example", "acme/app")).toBe(false);
    expect(repoAdded(rows, "git.corp.example", "acme/tool")).toBe(false);
    expect(repoAdded(rows, "github.com", "zed/other")).toBe(false);
  });
  it("names every host that did not answer", () => {
    expect(hostWarnings([])).toEqual([]);
    const w = hostWarnings([{ host: "git.corp.example", error: "timed out\nafter 30s" }]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("git.corp.example could not be reached");
    expect(w[0]).toContain("timed out after 30s");
  });
});

describe("GIT-045 (T-281-b) one refused repository is named and the others still list", () => {
  const item = (n: number, repo: string): Task => ({ kind: "issue", number: n, title: "t", url: `https://github.com/${repo}/issues/${n}`, repo, state: "open", draft: false, labels: [], assignees: [], updated: "2026-10-10T00:00:00Z", checks: null });
  it("carries the refused repositories of every host's page into the merged page", () => {
    const a: TaskPage = { total: 1, deepest: 1, items: [item(1, "o/a")], failed: [{ repo: "gone/x", error: "Validation Failed (HTTP 422)" }] };
    const b: TaskPage = { total: 1, deepest: 1, items: [item(2, "p/b")] };
    const merged = mergePages([a, b], ["github.com", "ghe.corp"]);
    expect(merged.items.map((t) => t.repo).sort()).toEqual(["o/a", "p/b"]);
    expect(merged.failed).toEqual([{ repo: "gone/x", error: "Validation Failed (HTTP 422)" }]);
    expect(mergePages([b, b], ["a", "b"]).failed).toBeUndefined();
  });
  it("warns once per refused repository, in plain words, with the reason cut short", () => {
    const w = repoWarnings([{ repo: "gone/x", error: "Validation Failed\n(HTTP 422): " + "y".repeat(400) }]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^gone\/x could not be searched \(Validation Failed \(HTTP 422\): y+\); the other repositories are listed without it\.$/);
    expect(w[0].length).toBeLessThan(260);
    expect(repoWarnings(undefined)).toEqual([]);
  });
});
