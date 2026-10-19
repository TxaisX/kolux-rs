// T-050-b (VIEW-019): the Show terminal switch is a real switch the keyboard and a screen reader know.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DRAFT_LIMIT } from "./composer";
import { handTooLongText } from "./model";
import { ChatHead, HandOff, TerminalSwitch, makeHand } from "./ChatView";

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

// FIX-5 (stand-in review of 6c0ea802, FIX-SOON 1): the Agents screen's hand-off wiring. The repo has
// no DOM test environment, so this drives the exact function AgentsChat builds its Hand with
// (makeHand) and renders the head AgentsChat's chat draws (ChatHead) from it.
describe("the Agents screen's Send result to wiring (FIX-5)", () => {
  const panes = [{ key: 1, cwd: "C:/a", title: "build" }, { key: 2, cwd: "C:/a", title: "docs" }];
  const offers = { 1: { chat: true, back: false, chooser: false }, 2: { chat: true, back: false, chooser: false } };
  const long = "r".repeat(DRAFT_LIMIT - 5);
  const esc = (t: string) => t.replace(/'/g, "&#x27;"); // renderToStaticMarkup escapes apostrophes

  const wire = (typed: string) => {
    const log = { kept: [] as [number, string][], picked: [] as number[], note: null as { text: string; forResult: string } | null };
    const hand = () =>
      makeHand({
        panes, key: 1, offers, viewed: [], note: log.note,
        setNote: (n) => { log.note = n; },
        onPick: (k) => void log.picked.push(k),
        draftOf: () => typed,
        keepDraft: (k, t) => void log.kept.push([k, t]),
      });
    return { log, hand };
  };

  it("a long reply on a typed draft shows the note beside the menu, keeps the draft and does not move the screen", () => {
    const { log, hand } = wire("check this:");
    hand().onHand(2, long);
    expect(log.kept).toEqual([]);
    expect(log.picked).toEqual([]);
    expect(log.note?.text).toBe(handTooLongText("docs"));
    const head = renderToStaticMarkup(createElement(ChatHead, { result: long, hand: hand() }));
    expect(head).toContain(esc(handTooLongText("docs")));
    expect(head).toContain('role="status"');
  });

  it("a reply that fits goes after the draft, moves the screen and leaves no note", () => {
    const { log, hand } = wire("check this:");
    hand().onHand(2, "the result");
    expect(log.kept).toEqual([[2, "check this:\n\nthe result"]]);
    expect(log.picked).toEqual([2]);
    expect(log.note).toBeNull();
  });

  it("the refusal note goes when a newer reply is shown (stand-in review AFTER 2)", () => {
    const { hand } = wire("check this:");
    hand().onHand(2, long);
    expect(renderToStaticMarkup(createElement(ChatHead, { result: long, hand: hand() }))).toContain(esc(handTooLongText("docs")));
    expect(renderToStaticMarkup(createElement(ChatHead, { result: "a newer reply", hand: hand() }))).not.toContain(esc(handTooLongText("docs")));
  });
});
