import { expect, test } from "vitest";
import { childCount, childState, promptHeading, worktreeLine } from "./rows";

test("VIEW-084: the worktree line says current, active or unavailable, and only current and active jump", () => {
  const open = ["C:\\w\\app", "C:\\w\\other"];
  expect(worktreeLine("C:\\w\\app", true, "c:/w/app/", open)).toMatchObject({ state: "current", jump: true });
  expect(worktreeLine("C:\\w\\other", true, "C:\\w\\app", open)).toMatchObject({ state: "active", jump: true, label: "Active workspace: other" });
  const gone = worktreeLine("C:\\w\\old", false, "C:\\w\\app", open);
  expect(gone).toMatchObject({ state: "unavailable", jump: false });
  expect(gone.tip).toContain("no longer exists");
  expect(worktreeLine("C:\\w\\idle", true, "C:\\w\\app", open)).toMatchObject({ state: "available", jump: false });
  expect(worktreeLine("C:\\w\\idle", null, null, [])).toMatchObject({ state: "available" });
  expect(worktreeLine(null, null, null, [])).toMatchObject({ state: "unknown", jump: false });
  // A deleted folder is unavailable even when it is the current workspace's name.
  expect(worktreeLine("C:\\w\\app", false, "C:\\w\\app", open).state).toBe("unavailable");
});

test("VIEW-084: a prompt card that only has a recent prompt says so, and children count and state read plainly", () => {
  expect(promptHeading({ recentPromptOnly: true })).toBe("Recent prompt");
  expect(promptHeading({ recentPromptOnly: false })).toBe("First prompt");
  expect(childState({ running: true })).toBe("running");
  expect(childState({ running: false })).toBe("finished");
  expect(childCount(0)).toBe("");
  expect(childCount(1)).toBe("1 sub-agent");
  expect(childCount(3)).toBe("3 sub-agents");
});
