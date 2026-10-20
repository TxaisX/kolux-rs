import { describe, expect, it } from "vitest";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { $getRoot, createEditor, type LexicalEditor } from "lexical";
import { GUTTER, hoverControls, menuEdits, overCell, type Geo } from "./tableHover";
import { registerTable, runTableEdit, TABLE, TABLE_NODES, tablesOf } from "./richTable";

// EDIT-011 (T-234-b): the geometry of the hover controls, and the positional edits they run.
// A table 300 wide from x=100: three columns of 100; header row 30 tall then two rows of 30, from y=50.
const G: Geo = { left: 100, top: 50, right: 400, bottom: 140, rows: [50, 80, 110, 140], cols: [100, 200, 300, 400] };

describe("which controls show", () => {
  it("shows none when the pointer is far from the table", () => {
    expect(hoverControls("t", G, 700, 700)).toEqual({ rows: [], cols: [] });
    expect(hoverControls("t", G, 100 - GUTTER - 5, 90)).toEqual({ rows: [], cols: [] });
  });

  it("offers a plus at the row line nearest the pointer and a cross on the row under it", () => {
    const c = hoverControls("t", G, 90, 108);
    expect(c.rows).toEqual([
      { edit: { kind: "row-add", table: "t", at: 2 }, at: 110, kind: "add" },
      { edit: { kind: "row-del", table: "t", at: 1 }, at: 95, kind: "del" },
    ]);
    expect(c.cols).toEqual([]);
  });

  it("never offers a plus above the header row, and the header row has no cross", () => {
    const c = hoverControls("t", G, 90, 52);
    expect(c.rows).toEqual([]);
    const near = hoverControls("t", G, 90, 82); // near the line under the header: a plus, still no cross on row 1 by mistake
    expect(near.rows.map((r) => r.kind + r.edit.at)).toEqual(["add1", "del1"]);
  });

  it("offers a plus at the bottom line to grow the table", () => {
    const c = hoverControls("t", G, 90, 139);
    expect(c.rows[0].edit).toEqual({ kind: "row-add", table: "t", at: 3 });
  });

  it("offers column controls above the table, including a plus before the first column", () => {
    const c = hoverControls("t", G, 104, 40);
    expect(c.cols[0]).toEqual({ edit: { kind: "col-add", table: "t", at: 0 }, at: 100, kind: "add" });
    expect(c.cols[1]).toEqual({ edit: { kind: "col-del", table: "t", at: 0 }, at: 150, kind: "del" });
    expect(c.rows).toEqual([]);
  });

  it("keeps showing while the pointer is on the control itself, outside the table", () => {
    expect(hoverControls("t", G, 80, 110).rows.length).toBe(2);
    expect(hoverControls("t", G, 205, 30).cols.length).toBe(2);
  });
});

describe("never blocking a cell", () => {
  it("a point inside the table box is a cell, a point in the strip around it is not", () => {
    expect(overCell(G, 250, 95)).toBe(true);
    expect(overCell(G, 90, 95)).toBe(false);
    expect(overCell(G, 250, 40)).toBe(false);
  });
});

describe("the right-click menu", () => {
  it("lists the six edits for the cell, the header row cannot be deleted", () => {
    const m = menuEdits("t", 0, 1, 3);
    expect(m.map((e) => e.label)).toEqual(["Row above", "Row below", "Delete row", "Column left", "Column right", "Delete column"]);
    expect(m.find((e) => e.label === "Delete row")!.disabled).toBe(true);
    expect(m.find((e) => e.label === "Row above")!.edit).toMatchObject({ at: 1 }); // never above the header
    expect(menuEdits("t", 2, 0, 1)[5].label).toBe("Delete table");
  });
});

const T = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
const mk = (md: string): LexicalEditor => {
  const ed = createEditor({ namespace: "t", nodes: TABLE_NODES, onError: (e) => { throw e; } });
  registerTable(ed);
  ed.update(() => $convertFromMarkdownString(md, [TABLE]), { discrete: true });
  return ed;
};
const out = (ed: LexicalEditor) => ed.getEditorState().read(() => $convertToMarkdownString([TABLE]));
const key = (ed: LexicalEditor) => ed.getEditorState().read(() => ($getRoot().getFirstChild() as { getKey(): string }).getKey());

describe("positional edits", () => {
  it("adds a row at a number, never above the header, and at the end", () => {
    const ed = mk(T);
    const k = key(ed);
    expect(runTableEdit(ed, { kind: "row-add", table: k, at: 2 })).toBe(true);
    expect(out(ed)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |");
    runTableEdit(ed, { kind: "row-add", table: k, at: 0 }); // clamped under the header
    expect(out(ed).split("\n")[2]).toBe("|  |  |");
    runTableEdit(ed, { kind: "row-add", table: k, at: 99 });
    expect(out(ed).split("\n").pop()).toBe("|  |  |");
  });

  it("removes a row but refuses the header row", () => {
    const ed = mk(T);
    const k = key(ed);
    expect(runTableEdit(ed, { kind: "row-del", table: k, at: 0 })).toBe(false);
    expect(runTableEdit(ed, { kind: "row-del", table: k, at: 1 })).toBe(true);
    expect(out(ed)).toBe("| a | b |\n| --- | --- |\n| 3 | 4 |");
  });

  it("adds a column with an equal share and removes one; the last column takes the table with it", () => {
    const ed = mk(T);
    const k = key(ed);
    runTableEdit(ed, { kind: "col-add", table: k, at: 1 });
    expect(out(ed)).toBe("| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |\n| 3 |  | 4 |");
    runTableEdit(ed, { kind: "col-del", table: k, at: 1 });
    expect(out(ed)).toBe(T);
    runTableEdit(ed, { kind: "col-del", table: k, at: 0 });
    runTableEdit(ed, { kind: "col-del", table: k, at: 0 });
    expect(out(ed)).toBe("");
    expect(tablesOf(ed)).toEqual([]);
  });

  it("an unknown table or a number out of range changes nothing", () => {
    const ed = mk(T);
    expect(runTableEdit(ed, { kind: "col-del", table: "nope", at: 0 })).toBe(false);
    expect(runTableEdit(ed, { kind: "col-del", table: key(ed), at: 7 })).toBe(false);
    expect(out(ed)).toBe(T);
  });
});
