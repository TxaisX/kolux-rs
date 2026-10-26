// VIEW-020 acceptance: the real makeHand (list) and handOver (delivery) driven the way AgentsChat drives them.
// MIRROR src/chat/ChatView.tsx:464-468 (viewed list kept with the real viewedFirst) and :492 (makeHand call).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { HandOff, makeHand } from "../ChatView";
import { viewedFirst } from "../model";

const chat = { chat: true, back: false, chooser: false };
const panes = [
  { key: 1, cwd: "C:/a", title: "build" },
  { key: 2, cwd: "C:/a", title: "docs" },
  { key: 3, cwd: "C:/a", title: "api tests" },
];
const offers = { 1: chat, 2: chat, 3: chat };

function wire(viewed: number[], drafts: Record<number, string> = {}) {
  const log = { kept: [] as [number, string][], picked: [] as number[] };
  const hand = makeHand({
    panes, key: 1, offers, viewed, note: null, setNote: () => {},
    onPick: (k) => void log.picked.push(k),
    draftOf: (k) => drafts[k] ?? "",
    keepDraft: (k, t) => void log.kept.push([k, t]),
  });
  return { hand, log };
}

test("box 1: two other chat sessions exist and the one viewed last is listed first, in the rendered menu too", () => {
  // the Agents screen showed 2, then 3 (the latest); the finished session 1 is on screen now
  const viewed = viewedFirst(viewedFirst([], 2), 3);
  expect(viewed).toEqual([3, 2]);
  const { hand } = wire(viewed);
  expect(hand.targets.map((t) => t.key)).toEqual([3, 2]);
  expect(hand.targets.map((t) => t.label)).toEqual(["api tests", "docs"]);
  const html = renderToStaticMarkup(createElement(HandOff, { targets: hand.targets, onPick: () => {} }));
  expect(html.indexOf("api tests")).toBeLessThan(html.indexOf("docs"));
  expect(html).not.toContain("build");
});

test("box 2: a result path with a space arrives quoted in the target's kept draft, after what was already typed", () => {
  const { hand, log } = wire([3, 2], { 3: "please review:" });
  hand.onHand(3, "C:/Users/me/My Docs/report.md", "m1");
  expect(log.kept).toEqual([[3, 'please review:\n\n"C:/Users/me/My Docs/report.md"']]);
  expect(log.picked).toEqual([3]);
  const none = wire([3, 2]);
  none.hand.onHand(2, "/home/me/my notes/a.md", "m2");
  expect(none.log.kept).toEqual([[2, '"/home/me/my notes/a.md"']]);
});
