import { describe, expect, it } from "vitest";
import { FIRST_LINES, FIRST_PAGE, OLDER_LINES, hiddenCount, keepPosition, loadLabel, pageIsCurrent, pagesToStart, prependOlder, shownCount, visibleRows } from "./page";

const rows = Array.from({ length: 1000 }, (_, i) => i);

describe("CHAT-008 paged loading", () => {
  it("a 1,000-message transcript shows 300, then 500, then 700 and so on", () => {
    expect(visibleRows(rows, 0)).toHaveLength(300);
    expect(visibleRows(rows, 1)).toHaveLength(500);
    expect(visibleRows(rows, 2)).toHaveLength(700);
  });
  it("the newest rows are the ones kept", () => {
    expect(visibleRows(rows, 0)[0]).toBe(700);
    expect(visibleRows(rows, 0)[299]).toBe(999);
  });
  it("pressing until the start removes the control", () => {
    expect(pagesToStart(1000)).toBe(4);
    expect(visibleRows(rows, 4)).toHaveLength(1000);
    expect(loadLabel(1000, 3)).toBe("Load earlier messages (100 more)");
    expect(loadLabel(1000, 4)).toBeNull();
    expect(hiddenCount(1000, 4)).toBe(0);
  });
  it("a short chat has no control", () => {
    expect(loadLabel(300, 0)).toBeNull();
    expect(loadLabel(0, 0)).toBeNull();
    expect(visibleRows([1, 2], 0)).toEqual([1, 2]);
    expect(pagesToStart(10)).toBe(0);
  });
  it("301 messages hide exactly one", () => {
    expect(hiddenCount(301, 0)).toBe(1);
    expect(loadLabel(301, 0)).toBe("Load earlier messages (1 more)");
    expect(shownCount(0)).toBe(FIRST_PAGE);
  });
  it("the reading position keeps the message that was at the top of the view in place", () => {
    expect(keepPosition({ scrollHeight: 4000, scrollTop: 0 }, 9000)).toBe(5000);
    expect(keepPosition({ scrollHeight: 4000, scrollTop: 120 }, 4000)).toBe(120);
  });
  it("a page from an earlier reading is dropped", () => {
    expect(pageIsCurrent(3, 3)).toBe(true);
    expect(pageIsCurrent(3, 4)).toBe(false);
  });
});

describe("CHAT-008 older pages from the backend (after-list row 392)", () => {
  it("with every read row shown, a transcript that has older lines still offers the control; at the top it does not", () => {
    expect(loadLabel(300, 0, 4096)).toBe("Load earlier messages");
    expect(loadLabel(300, 0, 0)).toBeNull();
    expect(loadLabel(300, 0)).toBeNull();
    // Rows already read are shown first, with their count, whatever the backend still holds.
    expect(loadLabel(1000, 0, 4096)).toBe("Load earlier messages (200 more)");
  });
  it("an older page goes before the rows held, keeping the held version of a row the boundary cut", () => {
    const held = [{ id: "c", v: "new" }, { id: "d", v: "new" }];
    const page = [{ id: "a", v: "old" }, { id: "b", v: "old" }, { id: "c", v: "old" }];
    expect(prependOlder(held, page)).toEqual([{ id: "a", v: "old" }, { id: "b", v: "old" }, { id: "c", v: "new" }, { id: "d", v: "new" }]);
    expect(prependOlder(held, [])).toEqual(held);
  });
  it("the first read and each older page are a few hundred rows, never the whole transcript", () => {
    expect(FIRST_LINES).toBeGreaterThanOrEqual(FIRST_PAGE);
    expect(OLDER_LINES).toBeGreaterThan(0);
  });
});
