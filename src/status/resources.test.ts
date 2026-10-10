import { expect, test } from "vitest";
import { groupSessions } from "./resources";

const u = { bytes: 1, cpu: 0, processes: 1 };

test("sessions sit under the deepest workspace they run in, the rest under No worktree", () => {
  const sessions = [
    { ...u, id: 1, dir: "C:\\repo" },
    { ...u, id: 2, dir: "C:\\repo\\ws\\alpha\\src" },
    { ...u, id: 3, dir: "C:\\Users\\me" },
    { ...u, id: 4, dir: null },
    { ...u, id: 5, dir: "C:/repo/ws/alpha" },
  ];
  const groups = groupSessions(sessions, { 1: "Terminal 1", 2: "Claude", 5: "Codex" }, ["C:/repo", "C:/repo/ws/alpha"]);
  expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
    ["repo", [1]],
    ["alpha", [2, 5]],
    ["No worktree", [3, 4]],
  ]);
  const hidden = groups[2].rows[0];
  expect([hidden.name, hidden.shown]).toEqual(["Session 3 (not in a pane)", false]);
  expect(groups[1].rows[0].shown).toBe(true);
});
