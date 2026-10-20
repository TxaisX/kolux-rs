import { expect, test } from "vitest";
import { checkName, isUntitled, needsName, suggestedName } from "./untitled";

const root = "C:\\w\\proj";
const none = () => false;

test("EDIT-054 (T-237-b): only untitled(-N).md at the worktree root is an unnamed note", () => {
  expect(isUntitled("C:\\w\\proj\\untitled.md", root)).toBe(true);
  expect(isUntitled("c:/w/proj/Untitled-12.md", root)).toBe(true);
  expect(isUntitled("C:/w/proj/docs/untitled.md", root)).toBe(false);
  expect(isUntitled("C:/w/proj/untitled.txt", root)).toBe(false);
  expect(isUntitled("C:/w/proj/untitled-x.md", root)).toBe(false);
  expect(isUntitled("C:/w/proj/untitled.md", null)).toBe(false);
  expect(suggestedName("C:\\w\\proj\\untitled-2.md")).toBe("untitled-2.md");
});

test("EDIT-054 (T-237-b): accepting the suggested name simply saves; a typed name gets .md and may include new folders", () => {
  expect(checkName("untitled.md", "C:/w/proj/untitled.md", root, () => true)).toEqual({ ok: true, path: "C:/w/proj/untitled.md", same: true });
  expect(checkName(" notes/ideas ", "C:/w/proj/untitled.md", root, none)).toEqual({ ok: true, path: "C:/w/proj/notes/ideas.md", same: false });
  expect(checkName("a.markdown", "C:/w/proj/untitled.md", "C:/w/proj/", none)).toEqual({ ok: true, path: "C:/w/proj/a.markdown", same: false });
});

test("EDIT-054 (T-237-b): a name that exists, or is not a name inside the worktree, is refused with a reason and nothing moves", () => {
  const taken = (f: string) => f.toLowerCase().endsWith("/plan.md");
  expect(checkName("Plan", "C:/w/proj/untitled.md", "C:/w/proj", taken)).toEqual({ ok: false, error: "Plan.md already exists; choose another name." });
  for (const bad of ["", "  ", "dir/", "C:/x.md", "/etc/x", "../x", "a//b/../c", "a?.md", "con.md", "x."]) {
    expect(checkName(bad, "C:/w/proj/untitled.md", "C:/w/proj", none).ok, bad).toBe(false);
  }
});

test("EDIT-054 (T-236-b): only an untitled note whose file is still the empty one asks for its name", () => {
  expect(needsName("C:/w/proj/untitled.md", "C:/w/proj", "")).toBe(true);
  expect(needsName("C:/w/proj/untitled-2.md", "C:/w/proj", "")).toBe(true);
  expect(needsName("C:/w/proj/untitled.md", "C:/w/proj", "# saved once\n")).toBe(false);
  expect(needsName("C:/w/proj/untitled.md", "C:/w/proj", null)).toBe(false);
  expect(needsName("C:/w/proj/sub/untitled.md", "C:/w/proj", "")).toBe(false);
  expect(needsName("C:/w/proj/untitled.md", null, "")).toBe(false);
});
