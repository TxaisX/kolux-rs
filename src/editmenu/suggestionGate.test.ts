import { describe, expect, it } from "vitest";
import { SuggestionGate } from "./suggestionGate";

describe("SuggestionGate", () => {
  it("takes the answer numbered for the open wait", () => {
    const g = new SuggestionGate();
    g.begin();
    expect(g.answer(1)).toBe(true);
    g.begin();
    expect(g.answer(2)).toBe(true);
  });

  it("drops a late answer that arrives during the next field's wait", () => {
    const g = new SuggestionGate();
    g.begin(); // field A
    g.timedOut(); // 300 ms passed, A drew its menu without words
    g.begin(); // field B
    expect(g.answer(1)).toBe(false); // A's late words
    expect(g.answer(2)).toBe(true); // B's own
  });

  it("drops a late answer that arrives after its wait and before the next", () => {
    const g = new SuggestionGate();
    g.begin();
    g.timedOut();
    expect(g.answer(1)).toBe(false);
    g.begin();
    expect(g.answer(2)).toBe(true);
  });

  it("a second right-click abandons the first wait", () => {
    const g = new SuggestionGate();
    g.begin(); // A, never answered in time
    g.begin(); // B
    expect(g.answer(1)).toBe(false);
    expect(g.answer(2)).toBe(true);
  });

  it("misses one answer, never uses a wrong one, when a timed-out request was never handled", () => {
    const g = new SuggestionGate();
    g.begin();
    g.timedOut(); // the host never handled A
    g.begin(); // B expects 2, the host numbers it 1
    expect(g.answer(1)).toBe(false);
    g.timedOut();
    g.begin(); // C is back in step
    expect(g.answer(2)).toBe(true);
  });

  it("ignores an answer when no wait is open", () => {
    const g = new SuggestionGate();
    expect(g.answer(1)).toBe(false);
    g.begin();
    expect(g.answer(2)).toBe(true);
  });

  it("keeps working after a request the host never handled", () => {
    const g = new SuggestionGate();
    g.begin();
    g.timedOut(); // never handled
    g.begin();
    expect(g.answer(1)).toBe(false); // one miss
    g.timedOut();
    for (const seq of [2, 3, 4]) {
      g.begin();
      expect(g.answer(seq)).toBe(true);
    }
  });
});
