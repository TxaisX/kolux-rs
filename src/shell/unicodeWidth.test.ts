import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { applyKoluxUnicode, cellWidth, charProps, inRuns, joins, KOLUX_UNICODE, stringCells, widthOf } from "./unicodeWidth";
import { DOUBLE_WIDTH, PICTOGRAPHIC, ZERO_WIDTH } from "./unicodeWidthData";

const cps = (...points: number[]) => String.fromCodePoint(...points);

describe("TERM-104 Unicode 16 width table (own provider, unicode.org data)", () => {
  it("keeps the generated runs sorted and paired", () => {
    for (const runs of [ZERO_WIDTH, DOUBLE_WIDTH, PICTOGRAPHIC]) {
      expect(runs.length % 2).toBe(0);
      for (let i = 1; i < runs.length; i++) expect(runs[i]).toBeGreaterThanOrEqual(runs[i - 1]);
    }
    expect(inRuns([0x10, 0x20], 0x10)).toBe(true);
    expect(inRuns([0x10, 0x20], 0x21)).toBe(false);
  });

  it("gives ASCII one cell, controls none, combining marks none", () => {
    expect(cellWidth(0x41)).toBe(1);
    expect(cellWidth(0x1b)).toBe(0);
    expect(cellWidth(0x0301)).toBe(0); // combining acute
    expect(cellWidth(0x200b)).toBe(0); // zero width space
    expect(cellWidth(0x00ad)).toBe(1); // soft hyphen is drawn
  });

  it("gives CJK, Hangul and fullwidth forms two cells", () => {
    expect(cellWidth(0x4e2d)).toBe(2); // 中
    expect(cellWidth(0xac00)).toBe(2); // 가
    expect(cellWidth(0xff21)).toBe(2); // fullwidth A
    expect(cellWidth(0x3400)).toBe(2); // CJK extension A
    expect(cellWidth(0x20000)).toBe(2); // CJK extension B
  });

  it("gives emoji newer than Unicode 6 two cells (xterm's own table said one)", () => {
    expect(cellWidth(0x1f600)).toBe(2); // grinning face, Unicode 6.1
    expect(cellWidth(0x1f918)).toBe(2); // sign of the horns, Unicode 8
    expect(cellWidth(0x1f97a)).toBe(2); // pleading face, Unicode 11
    expect(cellWidth(0x1fae8)).toBe(2); // shaking face, Unicode 15
    expect(cellWidth(0x2764)).toBe(1); // heavy black heart is text style until VS16
  });

  it("counts emoji sequences as one two-cell character", () => {
    expect(stringCells(cps(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467))).toBe(2); // family ZWJ sequence
    expect(stringCells(cps(0x1f44d, 0x1f3fd))).toBe(2); // thumbs up, medium skin tone
    expect(stringCells(cps(0x1f1fa, 0x1f1f8))).toBe(2); // US flag (two regional indicators)
    expect(stringCells(cps(0x1f1fa, 0x1f1f8, 0x1f1ef))).toBe(4); // a flag then a lone indicator (an emoji letter, also two cells)
    expect(stringCells(cps(0x2764, 0xfe0f))).toBe(2); // red heart, emoji style
    expect(stringCells(cps(0x2764, 0xfe0e))).toBe(1); // heart, text style
    expect(stringCells(cps(0x65, 0x301))).toBe(1); // e + combining acute
    expect(stringCells(cps(0x1100, 0x1161, 0x11a8))).toBe(2); // Hangul jamo L V T = one syllable
    expect(stringCells(cps(0x7c, 0x4e2d, 0x6587, 0x7c, 0x1f600, 0x7c))).toBe(9);
  });

  it("packs joins the way xterm reads them", () => {
    const base = charProps(0x1f468, 0);
    const zwj = charProps(0x200d, base);
    expect(joins(base)).toBe(false);
    expect(joins(zwj)).toBe(true);
    expect(widthOf(zwj)).toBe(2);
    expect(joins(charProps(0x0301, 0))).toBe(false); // a mark at the start has nothing to join
  });
});

describe("TERM-104 the provider inside a real xterm buffer", () => {
  const cursorAfter = (text: string) =>
    new Promise<number>((resolve) => {
      const term = new Terminal({ cols: 40, rows: 4, allowProposedApi: true });
      applyKoluxUnicode(term);
      applyKoluxUnicode(term); // twice is harmless
      expect(term.unicode.activeVersion).toBe(KOLUX_UNICODE);
      term.write(text, () => {
        resolve(term.buffer.active.cursorX);
        term.dispose();
      });
    });

  it("lands the cursor right after wide characters and emoji sequences", async () => {
    expect(await cursorAfter(cps(0x4e2d, 0x6587))).toBe(4);
    expect(await cursorAfter(cps(0x1f97a))).toBe(2);
    expect(await cursorAfter(cps(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x78))).toBe(3);
    expect(await cursorAfter(cps(0x1f1fa, 0x1f1f8, 0x7c))).toBe(3);
  });
});
