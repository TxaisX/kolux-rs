import { expect, test } from "vitest";
import { cleanPaths, MAX_DROP_BYTES, MAX_DROP_FILES, planDrop, refuseDrop, zoneOf } from "./desktopDrops";

const el = (matches: string[]) => ({ closest: (s: string) => (s.split(", ").some((part) => matches.includes(part)) ? {} : null) });

test("EDIT-039 (T-236-b): a drop with too many files or too many bytes is refused, the limit itself is fine", () => {
  const many = Array.from({ length: MAX_DROP_FILES + 1 }, (_, i) => `C:/d/f${i}.txt`);
  expect(refuseDrop(many)).toMatch(/at most 50/);
  expect(refuseDrop(many.slice(0, MAX_DROP_FILES))).toBeNull();
  expect(refuseDrop(["C:/a.txt"], MAX_DROP_BYTES + 1)).toMatch(/MB/);
  expect(refuseDrop(["C:/a.txt"], MAX_DROP_BYTES)).toBeNull();
  expect(refuseDrop(["C:/a.txt"], null)).toBeNull();
});

test("EDIT-039 (T-236-b): repeated paths (either slash, any case) and blanks are dropped from the list", () => {
  expect(cleanPaths(["C:/a/b.txt", "c:/a/B.txt", "", "  ", "C:/a/c.txt"])).toEqual(["C:/a/b.txt", "C:/a/c.txt"]);
  expect(cleanPaths(["C:\\a\\b.txt", "C:/a/b.txt"])).toEqual(["C:\\a\\b.txt"]);
  // 60 copies of one path are one file, not too many.
  expect(refuseDrop(Array.from({ length: 60 }, () => "C:/a.txt"))).toBeNull();
});

test("EDIT-039 (T-236-b): the project list takes folders, the editor area opens files, other places keep their own handler", () => {
  expect(zoneOf(el([".sidebar"]))).toBe("projects");
  expect(zoneOf(el([".explorer", ".sidebar"]))).toBe("own");
  expect(zoneOf(el([".pane", "[data-kind='terminal']"]))).toBe("own");
  expect(zoneOf(el([".pane.editor", ".pane"]))).toBe("editor");
  expect(zoneOf(el(["[role='dialog']"]))).toBe("own");
  expect(zoneOf(el([]))).toBe("editor");
  expect(zoneOf(null)).toBe("editor");
});

test("EDIT-039 (T-236-b): a folder on the project list becomes a project, a file there is explained; files open elsewhere, folders do not", () => {
  const mix = [{ path: "C:/p/repo", dir: true }, { path: "C:/p/a.txt", dir: false }];
  expect(planDrop("projects", mix)).toEqual({ action: "projects", paths: ["C:/p/repo"], say: null });
  expect(planDrop("projects", [mix[1]]).say).toMatch(/folder/);
  expect(planDrop("editor", mix)).toEqual({ action: "editor", paths: ["C:/p/a.txt"], say: null });
  expect(planDrop("editor", [mix[0]]).action).toBe("none");
  expect(planDrop("own", mix)).toEqual({ action: "none", paths: [], say: null });
  const many = Array.from({ length: 51 }, (_, i) => ({ path: `C:/f${i}`, dir: false }));
  expect(planDrop("editor", many).action).toBe("refused");
});
