import { describe, expect, it } from "vitest";
import { codeSpans } from "./richCodeColour";

// T-589 (L3-terminal-editor-js.1): highlight.js 11.11.1's C and C++ function rule backtracks without a
// bound on a long run of words, so one code block at the 20,000-character cap froze the rich view for
// about 1.5 s on open and again after each edit in it. 11.12.0 bounds the rule.
describe("code colour time", () => {
  it.each(["c", "cpp"])("colours a %s block at the size cap in well under a second", (lang) => {
    const code = "a ".repeat(10000); // 20,000 characters: still coloured
    const start = performance.now();
    codeSpans(code, lang);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
