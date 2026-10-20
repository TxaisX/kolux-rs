// T-249-c: the crash screen's Report button opens Send Feedback with the crash text above the block.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { crashText, reportCrash, ReportButton, STACK_LINES } from "./crash";

describe("crashText", () => {
  it("names the error and keeps the top of the stack", () => {
    const e = new TypeError("x is undefined");
    e.stack = ["TypeError: x is undefined", ...Array.from({ length: 30 }, (_, i) => `    at f${i} (index.js:${i}:1)`)].join("\n");
    const t = crashText(e);
    expect(t).toContain("Error: TypeError: x is undefined");
    expect(t).toContain("  at f0 (index.js:0:1)");
    expect(t).toContain(`  at f${STACK_LINES - 1} `);
    expect(t).not.toContain(`  at f${STACK_LINES} `);
    expect(t.endsWith("What I was doing:\n")).toBe(true);
  });
  it("a thrown non-Error and nothing at all still say something", () => {
    expect(crashText("boom")).toContain("Error: boom");
    expect(crashText(null)).toContain("Error: unknown error");
    expect(crashText(null)).not.toContain("Stack:");
  });
  it("keeps Firefox/WebKit style frames (name@url)", () => {
    const e = new Error("bad");
    e.stack = "render@app.js:1:2\nmount@app.js:3:4";
    expect(crashText(e)).toContain("  render@app.js:1:2");
  });
});

describe("reportCrash / ReportButton", () => {
  it("hands requestFeedback the crash text", () => {
    const got: string[] = [];
    reportCrash(new Error("bad"), (t) => got.push(t));
    expect(got).toHaveLength(1);
    expect(got[0]).toContain("Error: Error: bad");
  });
  it("the button reads Report", () => {
    expect(renderToStaticMarkup(createElement(ReportButton, { error: new Error("x"), request: () => {} }))).toBe('<button class="btn">Report</button>');
  });
});
