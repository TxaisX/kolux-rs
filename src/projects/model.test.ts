import { expect, test } from "vitest";
import { createOpens, folderName, orderWorktrees, placeFieldAction, previewSentence, worktreeLabel, type Worktree } from "./model";

const main: Worktree = { path: "C:\\src\\app", branch: "main", head: "aaaaaaa1", isMain: true };
const zeta: Worktree = { path: "C:\\ws\\app\\zeta", branch: "zeta", head: "bbbbbbb2", isMain: false };
const fix: Worktree = { path: "C:\\ws\\app\\fix-login", branch: "fix-login", head: "ccccccc3", isMain: false };
const loose: Worktree = { path: "C:\\ws\\app\\loose", branch: null, head: "ddddddd4ddd", isMain: false };

test("rows say the typed name, else the branch, else the short commit when detached", () => {
  expect(worktreeLabel({ ...fix, name: "Fix login \u{1F525}" })).toBe("Fix login \u{1F525}");
  expect(worktreeLabel(fix)).toBe("fix-login");
  expect(worktreeLabel(loose)).toBe("detached at ddddddd");
});

test("the main checkout is listed first, the rest by name, whatever order git gave", () => {
  expect(orderWorktrees([zeta, loose, fix, main]).map(worktreeLabel)).toEqual(["main", "detached at ddddddd", "fix-login", "zeta"]);
});

test("folder names come off either slash style", () => {
  expect(folderName("C:\\ws\\app\\fix-login")).toBe("fix-login");
  expect(folderName("/home/t/ws/app/")).toBe("app");
});

test("the preview sentence explains the branch and folder, or the refusal", () => {
  const project = { id: "app-1", name: "app", path: "C:\\src\\app" };
  expect(previewSentence("", null, project)).toMatch(/Type a name/);
  expect(previewSentence("???", null, project)).toMatch(/nothing usable/);
  expect(previewSentence("Fix login", { branch: "fix-login", folder: "C:\\ws\\app\\fix-login" }, project)).toBe("branch fix-login · folder C:\\ws\\app\\fix-login");
  expect(previewSentence("x", { branch: "x", folder: "" }, null)).toBe("Add a project first.");
});

test("New workspace with no project yet opens the add-project form instead of a dead name field (T-013-fix-a)", () => {
  expect(createOpens("")).toBe("add");
  expect(createOpens("app-1")).toBe("name");
});

test("the workspaces-folder field saves on Enter, reverts on Escape and ignores keys mid-composition (SET-032)", () => {
  expect(placeFieldAction("Enter", false)).toBe("save");
  expect(placeFieldAction("Escape", false)).toBe("revert");
  expect(placeFieldAction("Enter", true)).toBeNull();
  expect(placeFieldAction("Escape", true)).toBeNull();
  expect(placeFieldAction("a", false)).toBeNull();
});
