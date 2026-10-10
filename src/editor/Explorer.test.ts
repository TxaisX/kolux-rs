import { describe, expect, it } from "vitest";
import { between, flatten, type Node } from "./Explorer";

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
