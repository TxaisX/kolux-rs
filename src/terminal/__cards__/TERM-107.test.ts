// TERM-107 (T-566): a pane back from the saved layout wears its restored mark from its first paint. The mark used to be
// set only after the pane's first restore step (four IPC listener round trips) answered, so a pane read in that gap had
// no mark, and a key pressed in it was not counted. The pane also carries its saved key as data-key, so a prover can
// match a pane to the key it was saved under (two panes in one folder share a title).
import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import TerminalPane from "../TerminalPane";

// The first paint: effects (the restore, the terminal itself) never run here, as before the first IPC answer.
const paint = (props: { number?: number; restored?: boolean; resumed?: boolean }) => renderToString(createElement(TerminalPane, props));

test("box 1: a restored pane shows its mark in its first paint, before any restore step has answered", () => {
  expect(paint({ number: 7, restored: true })).toMatch(/<span class="status attention restored"[^>]*>restored<\/span>/);
});

test("box 2: a restored agent pane whose start line cannot resume says so from its first paint", () => {
  expect(paint({ number: 7, restored: true, resumed: false })).toMatch(/<span class="status attention restored"[^>]*>restored without resume<\/span>/);
});

test("a pane that did not come back from the saved layout has no mark", () => {
  expect(paint({ number: 8 })).not.toContain("status attention restored");
});

test("T-566: the pane's box carries its saved key as data-key; a pane without a key carries none", () => {
  expect(paint({ number: 7, restored: true })).toMatch(/<section[^>]*\sdata-key="7"/);
  expect(paint({})).not.toContain("data-key");
});
