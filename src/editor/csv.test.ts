import { describe, expect, it } from "vitest";
import { detectSeparator, isTable, parseRows, parseTable } from "./csv";

describe("CSV and TSV tables (EDIT-023)", () => {
  it("opens .csv and .tsv files as tables", () => {
    expect(isTable("a/b.CSV")).toBe(true);
    expect(isTable("x.tsv")).toBe(true);
    expect(isTable("x.csv.bak")).toBe(false);
    expect(isTable("notes.md")).toBe(false);
  });

  it("splits a semicolon file on the semicolons (acceptance 1)", () => {
    const t = parseTable("name;qty;price\nbolt;4;1,50\nnut;10;0,25\n", "stock.csv");
    expect(t.sep).toBe(";");
    expect(t.rows).toEqual([["name", "qty", "price"], ["bolt", "4", "1,50"], ["nut", "10", "0,25"]]);
  });

  it("keeps a quoted field with a comma, a line break or a doubled quote in one cell (acceptance 2)", () => {
    const t = parseTable('id,note\n1,"a, b"\n2,"line one\nline two"\n3,"say ""hi"""\n');
    expect(t.rows).toEqual([["id", "note"], ["1", "a, b"], ["2", "line one\nline two"], ["3", 'say "hi"']]);
  });

  it("ignores a byte-order mark and reads tab and pipe files", () => {
    expect(parseTable("﻿a,b\n1,2\n").rows[0]).toEqual(["a", "b"]);
    expect(parseTable("a\tb\tc\n1\t2\t3\n", "x.tsv")).toEqual({ sep: "\t", rows: [["a", "b", "c"], ["1", "2", "3"]] });
    expect(detectSeparator("a|b\n1|2\n")).toBe("|");
  });

  it("handles CRLF, a missing final line break, empty cells and a lone column", () => {
    expect(parseRows("a,b\r\n,2\r\n3,", ",")).toEqual([["a", "b"], ["", "2"], ["3", ""]]);
    expect(parseTable("one\ntwo\n")).toEqual({ sep: ",", rows: [["one"], ["two"]] });
    expect(parseTable("").rows).toEqual([]);
  });

  it("is not fooled by separators inside quotes when choosing the separator", () => {
    expect(detectSeparator('a;b\n"x,y,z";2\n"p,q,r";3\n')).toBe(";");
  });

  it("a quote in the middle of a cell is just a character", () => {
    expect(parseRows('5" nail,3\n', ",")).toEqual([['5" nail', "3"]]);
  });
});
