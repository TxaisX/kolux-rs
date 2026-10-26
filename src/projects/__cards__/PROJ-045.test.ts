// PROJ-045 box 1: a merged pull request puts its workspace in "Done" under Group by pull request.
// Box 2: the chosen grouping is what the sidebar reads back after a restart (the Rust half, the
// patch landing in the settings file and surviving a reopen, is src-tauri/tests/cards_01.rs).
import { beforeEach, expect, test, vi } from "vitest";
import { GROUP_SETTING, groupFromSetting, groupRows, type GroupBy, type PrState, type RowInfo } from "../rows";
import { mergePoll } from "../../scm/poll";
import { saveChanged } from "../../settings/saveChanged";

let disk = "{}"; // the settings file; settings_patch lays `set` over it and drops `remove`, like state::patched
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { set: Record<string, unknown>; remove: string[] }) => {
    expect(cmd).toBe("settings_patch");
    const next = { ...JSON.parse(disk), ...args.set };
    for (const k of args.remove) delete next[k];
    disk = JSON.stringify(next);
  },
}));
beforeEach(() => {
  disk = "{}";
});

test("Group by pull request: the workspace whose pull request merged sits in Done", () => {
  const pr = (state: string, number: number) => ({ number, url: `https://example.test/pull/${number}`, state });
  // what the poll leaves for four workspaces: one merged, one open, one with none, one closed
  const known = mergePoll({}, {
    limitedUntil: null,
    prs: [
      { path: "C:/w/merged", linked: false, pr: pr("MERGED", 1), error: null },
      { path: "C:/w/open", linked: false, pr: pr("OPEN", 2), error: null },
      { path: "C:/w/none", linked: false, pr: null, error: null },
      { path: "C:/w/closed", linked: false, pr: pr("CLOSED", 3), error: null },
    ],
  });
  const paths = Object.keys(known);
  const info = (p: string): RowInfo => ({ state: "idle", changed: 0, pr: known[p] as PrState });
  const groups = groupRows(paths, "pr", info, () => "app");
  const where = (p: string) => groups.find((g) => g.rows.includes(p))?.title;
  expect(where("C:/w/merged")).toBe("Done");
  expect(groups.find((g) => g.title === "Done")?.rows).toEqual(["C:/w/merged"]);
  expect([where("C:/w/open"), where("C:/w/none"), where("C:/w/closed")]).toEqual(["In progress", "No pull request", "Closed"]);
});

test("each grouping chosen is the grouping in place after a restart", async () => {
  for (const choice of ["none", "project", "status", "pr"] as GroupBy[]) {
    disk = "{}";
    const before: Record<string, unknown> = {}; // the window's settings on start
    await saveChanged(before, { ...before, [GROUP_SETTING]: choice }); // onSetting(GROUP_SETTING, choice) -> saveSetting
    const afterRestart = JSON.parse(disk) as Record<string, unknown>; // get_settings on the next start
    expect(groupFromSetting(afterRestart[GROUP_SETTING])).toBe(choice);
  }
  expect(GROUP_SETTING).toBe("workspaceGroupBy");
});
