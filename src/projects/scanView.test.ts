import { expect, test } from "vitest";
import { begin, importLine, setAll, stopNow, summary, take, toggle, type Found, type ScanEvent } from "./scanView";

const f = (path: string, bare = false): Found => ({ path, name: path.split("/").pop()!, bare, linked: null });
const ev = (over: Partial<ScanEvent>): ScanEvent => ({ scanId: 1, found: null, visited: 0, count: 0, done: false, stopped: false, limit: null, ...over });

test("PROJ-012 each repository found is listed and ticked, a bare one is listed but cannot be ticked, and a repeat or another scan changes nothing", () => {
  let s = begin(1);
  s = take(s, ev({ found: f("C:/w/a"), visited: 3 }));
  s = take(s, ev({ found: f("C:/w/origin.git", true), visited: 5 }));
  s = take(s, ev({ found: f("c:/W/A") }));
  s = take(s, ev({ scanId: 2, found: f("C:/w/other") }));
  expect(s.found.map((x) => x.path)).toEqual(["C:/w/a", "C:/w/origin.git"]);
  expect(s.ticked).toEqual(["C:/w/a"]);
  expect(toggle(s, "C:/w/origin.git").ticked).toEqual(["C:/w/a"]);
  expect(toggle(s, "C:/w/a").ticked).toEqual([]);
  expect(setAll(s, true).ticked).toEqual(["C:/w/a"]);
  expect(summary(s)).toBe("Looking: 2 repositories in 5 folders so far");
});

test("PROJ-012 stopping the scan keeps everything found so far selectable, and late results still arrive", () => {
  let s = take(begin(1), ev({ found: f("C:/w/a"), visited: 40 }));
  s = stopNow(s);
  expect(s.running).toBe(false);
  expect(s.found).toHaveLength(1);
  s = take(s, ev({ found: f("C:/w/b"), visited: 41 }));
  s = take(s, ev({ done: true, stopped: true, visited: 41 }));
  expect(s.found.map((x) => x.path)).toEqual(["C:/w/a", "C:/w/b"]);
  expect(summary(s)).toContain("Stopped: 2 repositories in 41 folders");
  expect(toggle(s, "C:/w/a").ticked).toEqual(["C:/w/b"]);
});

test("PROJ-012 a limit is named when it cut the scan short, and PROJ-013 the import line says group or separate", () => {
  let s = take(begin(1), ev({ found: f("C:/w/a"), visited: 20000 }));
  s = take(s, ev({ done: true, visited: 20000, limit: "folders" }));
  expect(summary(s)).toContain("It stopped at the folder limit.");
  expect(importLine(s, true)).toBe("1 repository will be added as one group.");
  expect(importLine(s, false)).toBe("1 repository will be added as separate projects.");
  expect(importLine(setAll(s, false), true)).toBe("Nothing is ticked.");
});
