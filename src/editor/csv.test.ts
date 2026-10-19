import { describe, expect, it } from "vitest";
import { CELL_CHARS, detectSeparator, isTable, parseRows, parseTable, SCAN_CHARS, SHOWN_ROWS } from "./csv";

// Counts numeric-index reads (text[i]) only. A slow path that used .slice() or .indexOf() would not show up
// here, so this is a regression guard for the scanning loop, not a proof of total cost.
function counting(text: string) {
  const state = { reads: 0 };
  const proxy = new Proxy(new String(text), {
    get(t, k, r) {
      if (typeof k === "string" && /^\d+$/.test(k)) state.reads++;
      const v = Reflect.get(t, k, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as unknown as string;
  return { proxy, state };
}

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
    const { proxy: counted, state } = counting(text);
    const rows = parseRows(counted, ",", 5);
    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual(["a", "b"]);
    expect(state.reads).toBeLessThan(50); // 5 rows of 4 characters, not 2 million (index reads only, see counting)
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

  // FIX-2 (council FIX-SOON 1, second round): an unterminated quote makes the rest of the file one cell.
  it("an unterminated quote stops at the character budget and says there are more", () => {
    const text = '"open,quote never closed\n' + "1,x\n".repeat(2_000_000); // 8M characters, one endless cell
    const { proxy, state } = counting(text);
    const t = parseTable(proxy, "bad.csv");
    expect(t.more).toBe(true);
    expect(t.rows).toEqual([]); // no row ever completed
    expect(state.reads).toBeLessThanOrEqual(SCAN_CHARS + 10);
    expect(state.reads).toBeGreaterThan(0);
  });

  it("a single cell over the cell limit stops the read at once", () => {
    const text = '"' + "y".repeat(CELL_CHARS * 3);
    const { proxy, state } = counting(text);
    const t = parseTable(proxy, "bad.csv");
    expect(t.more).toBe(true);
    expect(state.reads).toBeLessThanOrEqual(CELL_CHARS + 10);
  });

  it("rows finished before the unterminated quote are kept", () => {
    const text = 'h1,h2\n1,2\n"open\n' + "z,z\n".repeat(2_000_000);
    const t = parseTable(text, "bad.csv");
    expect(t.more).toBe(true);
    expect(t.rows).toEqual([["h1", "h2"], ["1", "2"]]);
  });

  it("a well-formed file with a long cell under the limits is read in full", () => {
    const big = "x".repeat(200_000);
    const t = parseTable('a,b\n"' + big + '",2\n3,4\n');
    expect(t.more).toBeUndefined();
    expect(t.rows).toHaveLength(3);
    expect(t.rows[1][0]).toHaveLength(200_000);
  });
});
