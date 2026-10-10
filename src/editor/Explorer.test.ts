import { describe, expect, it } from "vitest";
import { between, DRAFT, flatten, isWsl, redoOf, tops, undoOf, type Node } from "./Explorer";

const dir = (path: string): Node => ({ name: path.split("/").pop()!, path, kind: "dir" });
const file = (path: string): Node => ({ name: path.split("/").pop()!, path, kind: "file" });
const kids = { "/r": [dir("/r/a"), dir("/r/b"), file("/r/c.ts")], "/r/a": [file("/r/a/x.ts")], "/r/b": [file("/r/b/y.ts"), file("/r/b/z.ts")] };

describe("explorer rows", () => {
  it("shows only the children of open folders, depth first, each knowing its parent", () => {
    expect(flatten("/r", kids, new Set()).map((r) => r.node.path)).toEqual(["/r/a", "/r/b", "/r/c.ts"]);
    const rows = flatten("/r", kids, new Set(["/r/b"]));
    expect(rows.map((r) => [r.node.path, r.depth, r.parent])).toEqual([
      ["/r/a", 0, null],
      ["/r/b", 0, null],
      ["/r/b/y.ts", 1, "/r/b"],
      ["/r/b/z.ts", 1, "/r/b"],
      ["/r/c.ts", 0, null],
    ]);
  });
  it("keeps an open folder whose children have not loaded yet as a plain row", () => {
    expect(flatten("/r", { "/r": kids["/r"] }, new Set(["/r/a"])).length).toBe(3);
  });
  it("selects a range from either end", () => {
    const rows = flatten("/r", kids, new Set(["/r/b"]));
    expect(between(rows, 1, 3)).toEqual(["/r/b", "/r/b/y.ts", "/r/b/z.ts"]);
    expect(between(rows, 3, 1)).toEqual(between(rows, 1, 3));
  });
});

describe("explorer file operations", () => {
  it("puts the new-name row first in its folder", () => {
    const rows = flatten("/r", kids, new Set(["/r/b"]), { dir: "/r/b", folder: false });
    expect(rows.map((r) => r.node.path)).toEqual(["/r/a", "/r/b", DRAFT, "/r/b/y.ts", "/r/b/z.ts", "/r/c.ts"]);
    expect(rows[2].depth).toBe(1);
  });
  it("deletes a folder chosen with its own children once, as the folder", () => {
    expect(tops(["/r/b", "/r/b/y.ts", "/r/c.ts", "/r/bb"])).toEqual(["/r/b", "/r/c.ts", "/r/bb"]);
  });
  it("undoes and redoes each action with its opposite", () => {
    expect(undoOf({ kind: "create", path: "/r/n.ts" })).toEqual(["fs_trash", { paths: ["/r/n.ts"] }]);
    expect(redoOf({ kind: "create", path: "/r/n.ts" })).toEqual(["fs_restore", { paths: ["/r/n.ts"] }]);
    expect(undoOf({ kind: "rename", from: "C:\\r\\a.ts", to: "C:\\r\\b.ts" })).toEqual(["fs_rename", { path: "C:\\r\\b.ts", name: "a.ts" }]);
    expect(redoOf({ kind: "rename", from: "/r/a.ts", to: "/r/b.ts" })).toEqual(["fs_rename", { path: "/r/a.ts", name: "b.ts" }]);
    expect(undoOf({ kind: "trash", paths: ["/r/a", "/r/c.ts"] })).toEqual(["fs_restore", { paths: ["/r/a", "/r/c.ts"] }]);
    expect(redoOf({ kind: "trash", paths: ["/r/a"] })).toEqual(["fs_trash", { paths: ["/r/a"] }]);
  });
  it("knows a WSL share, where a delete is for good", () => {
    expect(isWsl("\\\\wsl$\\Ubuntu\\home\\a")).toBe(true);
    expect(isWsl("\\\\wsl.localhost\\Ubuntu\\x")).toBe(true);
    expect(isWsl("//wsl.localhost/Ubuntu/x")).toBe(true);
    expect(isWsl("C:\\wsl$\\x")).toBe(false);
  });
});
