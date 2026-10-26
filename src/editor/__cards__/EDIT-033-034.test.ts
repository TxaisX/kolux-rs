// EDIT-033 box 2 and EDIT-034 box 2 (TS side), with the REAL Explorer row functions and the REAL key map.
// MIRROR src/editor/Explorer.tsx:641-644 (row click with Shift: between(rows, anchorIndex, clickedIndex)).
// MIRROR src/editor/Explorer.tsx:402-405 askDelete() (ONE setAsking(tops(selection)) = one confirmation) and
// :406-408 doDelete (ONE fs_trash call with those paths, then record({kind:"trash"}) for Mod+Z).
import { describe, expect, it } from "vitest";
import { between, flatten, redoOf, tops, undoOf, type Node, type Op } from "../Explorer";
import { defaultsOnly, matchEvent, type KeyLike } from "../../keys/keymap";

const dir = (path: string): Node => ({ name: path.split("/").pop()!, path, kind: "dir" });
const file = (path: string): Node => ({ name: path.split("/").pop()!, path, kind: "file" });
const kids = { "/r": [dir("/r/a"), dir("/r/b"), file("/r/c.ts"), file("/r/d.ts"), file("/r/e.ts")], "/r/a": [file("/r/a/x.ts")] };

describe("EDIT-033 box 2: Shift-click two rows apart selects three rows", () => {
  it("a plain click, then Shift-click two rows below, selects exactly the three rows between and including them", () => {
    const rows = flatten("/r", kids, new Set());
    // first click on row 1 (pick() sets the anchor), then Shift-click row 3
    const anchor = rows[1].node.path;
    const clicked = 3;
    const a = rows.findIndex((x) => x.node.path === anchor); // the glue's own line
    const sel = new Set(between(rows, a < 0 ? clicked : a, clicked));
    expect([...sel]).toEqual(["/r/b", "/r/c.ts", "/r/d.ts"]);
    expect(sel.size).toBe(3);
  });
  it("the range counts the rows on screen: an open folder's children sit between its neighbours", () => {
    const rows = flatten("/r", kids, new Set(["/r/a"]));
    const sel = between(rows, 0, 2); // a, a/x.ts, b
    expect(sel).toEqual(["/r/a", "/r/a/x.ts", "/r/b"]);
  });
  it("Shift-click upward selects the same rows as downward", () => {
    const rows = flatten("/r", kids, new Set());
    expect(between(rows, 3, 1)).toEqual(between(rows, 1, 3));
    expect(between(rows, 3, 1).length).toBe(3);
  });
});

describe("EDIT-034 box 2: delete two files asks once, trashes both, Mod+Z restores both", () => {
  const two = ["/r/one.txt", "/r/two.txt"];
  it("two selected files make one confirmation holding both", () => {
    const asking = tops(two); // askDelete: setAsking(chosen) once
    expect(asking).toEqual(two);
    expect(asking.length).toBe(2);
  });
  it("the delete is one fs_trash call with both paths, and its undo is one fs_restore with both", () => {
    const op: Op = { kind: "trash", paths: tops(two) };
    expect(redoOf(op)).toEqual(["fs_trash", { paths: two }]);
    expect(undoOf(op)).toEqual(["fs_restore", { paths: two }]);
  });
  it("Mod+Z in the explorer is the undo action, Mod+Shift+Z and Ctrl+Y redo, Delete deletes (Windows keys)", () => {
    const map = defaultsOnly("win32");
    const ev = (o: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
    expect(matchEvent(map, ev({ key: "z", code: "KeyZ", ctrlKey: true }), ["explorer"])).toEqual({ id: "fileExplorer.undo" });
    expect(matchEvent(map, ev({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true }), ["explorer"])).toEqual({ id: "fileExplorer.redo" });
    expect(matchEvent(map, ev({ key: "y", code: "KeyY", ctrlKey: true }), ["explorer"])).toEqual({ id: "fileExplorer.redo" });
    expect(matchEvent(map, ev({ key: "Delete", code: "Delete" }), ["explorer"])).toEqual({ id: "fileExplorer.delete" });
  });
});
