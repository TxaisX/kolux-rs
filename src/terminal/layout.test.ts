// PROJ-067: tabs and layout are saved and restored; damaged entries are dropped on their own and
// the active workspace and tab come back while they still exist.
import { expect, test } from "vitest";
import { layoutOf, restoreLayout, resumeArgs, resumes, stillThere } from "./layout";

const shell = (key: number, cwd: string | null, extra: Record<string, unknown> = {}) => ({ key, cwd, branch: null, agent: "shell" as const, program: null, args: [], ...extra });

test("proj067: what is written down is each started tab, stripped to what a restart can rebuild", () => {
  const panes = [
    shell(1, null),
    { ...shell(2, "C:\\w\\a"), agent: "claude" as const, agentId: "claude", program: "claude", args: ["--prompt", "do the thing"], env: [["X", "1"]], typed: "do", task: "t", account: "acct-1", title: "Claude", group: 2 },
    shell(3, "C:\\w\\a", { seats: [{}] }), // a chooser never started: not a tab yet
    shell(4, "C:\\w\\b", { kind: "editor", path: "C:\\w\\b\\README.md", group: 4 }),
    shell(5, "C:\\w\\b", { kind: "browser" }),
  ];
  const l = layoutOf(panes, { 1: 1, 2: 2, 4: 4, 9: 3 }, 2, "C:\\w\\a", { "C:\\w\\b": true });
  expect(l.panes.map((p) => p.key)).toEqual([1, 2, 4, 5]);
  expect(l.panes[1]).toEqual({ key: 2, cwd: "C:\\w\\a", branch: null, agent: "claude", agentId: "claude", program: "claude", args: [], account: "acct-1", title: "Claude", group: 2 });
  expect(l.panes[2]).toEqual({ key: 4, cwd: "C:\\w\\b", branch: null, agent: "shell", program: null, args: [], group: 4, kind: "editor", path: "C:\\w\\b\\README.md" });
  expect(l.activeTab).toEqual({ 1: 1, 2: 2, 4: 4 }); // the chooser's cell entry went with it
  expect(l.focused).toBe(2);
  expect(l.activeDir).toBe("C:\\w\\a");
  expect(l.stacked).toEqual({ "C:\\w\\b": true });
  // The round trip is the identity.
  expect(restoreLayout(JSON.parse(JSON.stringify(l)))).toEqual(l);
});

test("proj067: a damaged entry is dropped and the other tabs still come back", () => {
  const saved = {
    panes: [
      shell(1, null),
      "garbage",
      { key: "two", cwd: null, branch: null, agent: "shell", program: null, args: [] }, // no key
      { ...shell(3, "C:\\w\\a"), agent: "gemini" }, // unknown agent
      { ...shell(4, "C:\\w\\a"), kind: "editor" }, // an editor tab without a path
      { ...shell(5, "C:\\w\\a"), args: [1, 2] },
      { ...shell(6, "C:\\w\\a"), kind: "diff", path: "x.ts", staged: true, group: 6, title: 7 },
      shell(6, "C:\\w\\c"), // a repeated key: the first one stands
    ],
    activeTab: { 1: 1, 6: 6, 7: 3, 8: "x" },
    focused: 3, // the dropped one
    activeDir: "C:\\w\\a",
    stacked: { "C:\\w\\a": true, "C:\\w\\b": "yes" },
  };
  const l = restoreLayout(saved)!;
  expect(l.panes.map((p) => p.key)).toEqual([1, 6]);
  expect(l.panes[1]).toEqual({ key: 6, cwd: "C:\\w\\a", branch: null, agent: "shell", program: null, args: [], group: 6, kind: "diff", path: "x.ts", staged: true });
  expect(l.activeTab).toEqual({ 1: 1, 6: 6 });
  expect(l.focused).toBe(6); // the first tab of the active workspace
  expect(l.stacked).toEqual({ "C:\\w\\a": true });
  expect(restoreLayout(null)).toBeNull();
  expect(restoreLayout("{}")).toBeNull();
  expect(restoreLayout({ panes: ["x", 1] })).toBeNull();
  expect(restoreLayout({ panes: [shell(1, null)], focused: "1", activeDir: 5 })).toEqual({ panes: [shell(1, null)], activeTab: {}, focused: 1, activeDir: null, stacked: {} });
});

test("proj067: the active workspace and tab come back when they still exist, else the tabs in a gone folder go", () => {
  const l = restoreLayout({ panes: [shell(1, null), shell(2, "C:\\w\\a"), shell(3, "C:\\w\\b"), shell(4, "C:\\w\\b")], activeTab: { 1: 1, 2: 2, 3: 4 }, focused: 4, activeDir: "C:\\w\\b", stacked: {} })!;
  const same = stillThere(l, () => true);
  expect(same).toEqual(l);
  expect(same.activeDir).toBe("C:\\w\\b");
  expect(same.focused).toBe(4);
  const gone = stillThere(l, (d) => d !== "C:\\w\\b");
  expect(gone.panes.map((p) => p.key)).toEqual([1, 2]);
  expect(gone.activeDir).toBeNull();
  expect(gone.focused).toBe(1); // the home tab, since the active workspace is gone
  expect(gone.activeTab).toEqual({ 1: 1, 2: 2 });
});

test("sess030: an agent tab with a known session comes back resumed, one without comes back at its prompt, never in a picker", () => {
  const claude = { key: 2, cwd: "C:\\w\\a", branch: "main", agent: "claude" as const, agentId: "claude", program: "claude", args: ["--dangerously-skip-permissions", "fix the build"], session: "11111111-aaaa" };
  const codex = { key: 3, cwd: "C:\\w\\a", branch: "main", agent: "codex" as const, agentId: "codex", program: null, args: ["--full-auto"], session: "thr_22" };
  const fresh = { key: 4, cwd: "C:\\w\\a", branch: "main", agent: "claude" as const, agentId: "claude", program: "claude", args: ["hello"] };
  const l = layoutOf([shell(1, null), claude, codex, fresh], { 1: 1, 2: 4 }, 4, "C:\\w\\a", {});
  // The session id is written down; the one-off opening arguments are not.
  expect(l.panes.map((p) => [p.key, p.args, p.session])).toEqual([[1, [], undefined], [2, [], "11111111-aaaa"], [3, [], "thr_22"], [4, [], undefined]]);
  const back = restoreLayout(JSON.parse(JSON.stringify(l)))!;
  expect(back.panes.map((p) => [p.key, p.args])).toEqual([[1, []], [2, ["--resume", "11111111-aaaa"]], [3, ["resume", "thr_22"]], [4, []]]);
  expect(back.panes[1].session).toBe("11111111-aaaa");
  // A damaged session id is no session: the tab comes back at its prompt, not in the pick-a-session screen.
  const odd = restoreLayout({ panes: [{ ...l.panes[1], session: 7 }], activeTab: {}, focused: 2, activeDir: null, stacked: {} })!;
  expect(odd.panes[0].args).toEqual([]);
  expect(resumeArgs("claude", undefined)).toEqual([]);
  expect(resumeArgs("claude", "")).toEqual([]);
  expect(resumeArgs("shell", "x")).toEqual([]);
});

test("TERM-107: a restored agent pane counts as resumed only when its start line carries the resume flag", () => {
  expect(resumes("claude", ["--resume", "abc"])).toBe(true);
  expect(resumes("codex", ["resume", "abc"])).toBe(true);
  expect(resumes("claude", [])).toBe(false);
  expect(resumes("codex", ["--resume", "abc"])).toBe(false);
  expect(resumes("shell", [])).toBe(false);
});
