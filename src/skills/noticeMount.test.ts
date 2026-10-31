// After-list row 62: the window itself mounts the skills notice, with the real "settings read" flag.
import { expect, test } from "vitest";
import { windowSource } from "../shell/windowSource";

// src has no node types; the builtin comes through process.getBuiltinModule (as chat/railWidth.test.ts does).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: string, enc: string): string } } }).process.getBuiltinModule("node:fs");
const readFileSync = nodeFs.readFileSync;

test("App mounts SkillUpdateNotice app-wide and waits for settings", () => {
  const app = windowSource;
  expect(app).toContain("<SkillUpdateNotice settingsLoaded={settingsRead} />");
});

test("the Skills page no longer owns the one-time notice", () => {
  const page = readFileSync("src/skills/SkillUpdate.tsx", "utf8");
  expect(page).not.toContain("shownThisSession");
});
