// T-050-b (VIEW-019): the Show terminal switch is a real switch the keyboard and a screen reader know.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { HandOff, TerminalSwitch } from "./ChatView";

describe("the Show terminal switch", () => {
  it("is a labelled checkbox with the switch role that says whether it is on", () => {
    const off = renderToStaticMarkup(createElement(TerminalSwitch, { on: false, onFlip: () => {} }));
    expect(off).toContain('role="switch"');
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain("Show terminal");
    const on = renderToStaticMarkup(createElement(TerminalSwitch, { on: true, onFlip: () => {} }));
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain("checked");
  });
});

describe("Send result to (VIEW-020)", () => {
  it("lists the target sessions in the order given, as buttons", () => {
    const html = renderToStaticMarkup(createElement(HandOff, { targets: [{ key: 3, label: "api tests" }, { key: 2, label: "docs" }], onPick: () => {} }));
    expect(html).toContain("Send result to");
    expect(html.indexOf("api tests")).toBeLessThan(html.indexOf("docs"));
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});
