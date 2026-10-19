import { describe, expect, it } from "vitest";
import { detectSeparator, isTable, parseRows, parseTable, SHOWN_ROWS } from "./csv";

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

  // FIX-1 (council FIX-SOON 1): a huge file must not be parsed whole on the window thread.
  it("stops reading after the rows asked for (limit)", () => {
    const text = "a,b\n".repeat(500_000);
    let reads = 0;
    const counted = new Proxy(new String(text), {
      get(t, k, r) {
        if (typeof k === "string" && /^\d+$/.test(k)) reads++;
        const v = Reflect.get(t, k, r);
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as unknown as string;
    const rows = parseRows(counted, ",", 5);
    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual(["a", "b"]);
    expect(reads).toBeLessThan(50); // 5 rows of 4 characters, not 2 million
    expect(parseRows("a\nb\nc\n", ",", 0)).toEqual([]);
    expect(parseRows("a\r\nb\r\nc\r\n", ",", 2)).toEqual([["a"], ["b"]]);
  });

  it("a huge table returns the header, the shown rows and one more, and says there are more", () => {
    const huge = "id,name\n" + "1,x\n".repeat(1_000_000);
    const t = parseTable(huge, "big.csv");
    expect(t.rows).toHaveLength(SHOWN_ROWS + 2);
    expect(t.more).toBe(true);
    expect(t.rows[0]).toEqual(["id", "name"]);
  });

  it("a table that fits is complete and does not claim more", () => {
    const exact = "h\n" + "1\n".repeat(SHOWN_ROWS);
    expect(parseTable(exact).rows).toHaveLength(SHOWN_ROWS + 1);
    expect(parseTable(exact).more).toBeUndefined();
    expect(parseTable(exact + "last\n").more).toBe(true);
  });
});
