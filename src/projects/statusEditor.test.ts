import { expect, test } from "vitest";
import { addRow, canSave, editorRows, moveRow, removeRow, renameRow, savePayload } from "./statusEditor";

const list = [
  { id: "todo", label: "To do" },
  { id: "done", label: "Done" },
];

test("PROJ-084: adding a custom status puts a new row last, with no id until it is saved", () => {
  const rows = addRow(editorRows(list), "Needs review");
  expect(rows.map((r) => r.label)).toEqual(["To do", "Done", "Needs review"]);
  expect(savePayload(rows)).toEqual([["todo", "To do"], ["done", "Done"], [null, "Needs review"]]);
});

test("PROJ-084: reordering keeps each status's id, so workspaces keep theirs; the ends stay put", () => {
  const rows = moveRow(editorRows(list), 1, -1);
  expect(savePayload(rows)).toEqual([["done", "Done"], ["todo", "To do"]]);
  expect(moveRow(rows, 0, -1)).toBe(rows);
  expect(moveRow(rows, 1, 1)).toBe(rows);
});

test("PROJ-084: rename keeps the id; a blank row is not sent and never saves an empty workflow", () => {
  const rows = renameRow(editorRows(list), 0, "Backlog");
  expect(savePayload(rows)[0]).toEqual(["todo", "Backlog"]);
  expect(savePayload(addRow(rows, "  "))).toHaveLength(2);
  const none = removeRow(removeRow(rows, 1), 0);
  expect(canSave(none)).toBe(false);
  expect(canSave(rows)).toBe(true);
});
