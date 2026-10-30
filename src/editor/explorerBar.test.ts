import { expect, test } from "vitest";
import { EXPAND_CAP, insideDir, menuLabel, nextWave, openRow, withExtraMenu } from "./explorerBar";
import { rowMenu } from "./explorerView";
import { isLog } from "./logFollow";
import type { Node } from "./Explorer";
import appSource from "../App.tsx?raw";

const W = "C:\\w";
const d = (name: string, parent = W): Node => ({ name, path: `${parent}\\${name}`, kind: "dir" });
const f = (name: string, parent = W): Node => ({ name, path: `${parent}\\${name}`, kind: "file" });

test("VIEW-059: expand all picks the unopened folders, not files, dot folders or build output", () => {
  const lists = { [W]: [d("src"), d(".git"), d("node_modules"), d("target"), f("a.txt"), d("docs")] };
  expect(nextWave(lists, new Set(), 10)).toEqual([`${W}\\src`, `${W}\\docs`]);
  expect(nextWave(lists, new Set([`${W}\\src`]), 10)).toEqual([`${W}\\docs`]);
});

test("VIEW-059: each wave is capped by the room left, and a deeper wave is found once its folder was listed", () => {
  const many = Array.from({ length: 500 }, (_, i) => d(`d${i}`));
  expect(nextWave({ [W]: many }, new Set(), EXPAND_CAP)).toHaveLength(EXPAND_CAP);
  expect(nextWave({ [W]: many }, new Set(), 0)).toEqual([]);
  const seen = new Set([`${W}\\src`]);
  expect(nextWave({ [W]: [d("src")], [`${W}\\src`]: [d("lib", `${W}\\src`)] }, seen, 5)).toEqual([`${W}\\src\\lib`]);
});

test("VIEW-059: Windows paths compare without case or slash direction and only on whole folder names; other paths keep case", () => {
  const share = "\\\\srv\\share";
  expect(insideDir("C:\\Work\\Repo\\a.txt", "c:/work/repo")).toBe(true);
  expect(insideDir("\\\\Srv\\Share2\\x", share)).toBe(false);
  expect(insideDir("\\\\SRV\\SHARE\\x", `${share}\\`)).toBe(true);
  expect(insideDir("C:\\Work\\Repo", "C:\\Work\\Repo")).toBe(false);
  expect(insideDir("/home/u/Repo/a", "/home/u/repo")).toBe(false);
  expect(insideDir("/home/u/repo/a", "/home/u/repo")).toBe(true);
});

test("VIEW-060: an open folder offers Collapse first, a single file offers Copy as file, others do not", () => {
  const folder = rowMenu({ isDir: true, hasTerminal: true, canProject: false });
  expect(withExtraMenu(folder, { isDir: true, isOpen: true, single: true })[0]).toBe("collapse");
  expect(withExtraMenu(folder, { isDir: true, isOpen: false, single: true })).toEqual(folder);
  const file = rowMenu({ isDir: false, hasTerminal: true, canProject: false });
  const one = withExtraMenu(file, { isDir: false, isOpen: false, single: true });
  expect(one[one.length - 1]).toBe("copyFile");
  expect(withExtraMenu(file, { isDir: false, isOpen: false, single: false })).toEqual(file);
  expect(menuLabel("collapse")).toBe("Collapse");
  expect(menuLabel("copyFile")).toBe("Copy as file");
  expect(menuLabel("rename")).toBe("Rename");
});

test("EDIT-026 (T-317): a log file's row menu offers Follow log right after View file; other files and folders do not", () => {
  const file = rowMenu({ isDir: false, hasTerminal: true, canProject: false });
  expect(withExtraMenu(file, { isDir: false, isOpen: false, single: true, log: true }).slice(0, 2)).toEqual(["view", "follow"]);
  expect(withExtraMenu(file, { isDir: false, isOpen: false, single: false, log: true }).slice(0, 2)).toEqual(["view", "follow"]);
  expect(withExtraMenu(file, { isDir: false, isOpen: false, single: true, log: false })).not.toContain("follow");
  const folder = rowMenu({ isDir: true, hasTerminal: true, canProject: false });
  expect(withExtraMenu(folder, { isDir: true, isOpen: false, single: true, log: true })).not.toContain("follow");
  expect(menuLabel("follow")).toBe("Follow log");
});

test("EDIT-026 (T-317): Follow log opens the file as a followed tab; View file opens a plain one; only .log names count", () => {
  const asked: unknown[][] = [];
  openRow("follow", "C:\\w\\logs\\agent.log", (...a) => void asked.push(a));
  openRow("view", "C:\\w\\logs\\agent.log", (...a) => void asked.push(a));
  expect(asked).toEqual([
    ["C:\\w\\logs\\agent.log", undefined, undefined, true],
    ["C:\\w\\logs\\agent.log", undefined, undefined, false],
  ]);
  expect([isLog("C:\\w\\logs\\Agent.LOG"), isLog("/w/build.log"), isLog("/w/a.ts"), isLog("/w/catalog"), isLog("/w/app.log.1")]).toEqual([true, true, false, false, false]);
});

test("EDIT-026 (T-317): App gives the Explorer its own openFile, so the follow flag is not dropped on the way to the tab", () => {
  expect(appSource.replace(/\r/g, "")).toMatch(/<Explorer\b[^>]*\bonOpen=\{openFile\}/);
});
