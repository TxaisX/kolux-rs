// TERM-068 acceptance box 1: with a split, Ctrl+V / Ctrl+Shift+V / Shift+Insert paste into the focused pane only.
// Box 2 (a pane switch during an asynchronous clipboard read) has no unit proof: see the ledger.
import { expect, test } from "vitest";
import { resolve, type KeyLike } from "../../keys/keymap";
import { attachPaste } from "../paste";
import { routeKey } from "../shellKeys";

const press = (k: Partial<KeyLike>): KeyLike => ({ key: "v", code: "KeyV", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });
const paste = (target: EventTarget, text: string) => {
  const e = Object.assign(new Event("paste", { cancelable: true }), { clipboardData: { getData: () => text } });
  target.dispatchEvent(e);
  return e;
};

test("box 1: the paste chords are left to the browser, whose paste event reaches only the focused pane's text area", () => {
  for (const platform of ["win32", "linux"] as const) {
    const map = resolve(null, platform);
    for (const k of [press({ ctrlKey: true }), press({ ctrlKey: true, shiftKey: true, key: "V" }), press({ key: "Insert", code: "Insert", shiftKey: true })]) {
      // TerminalPane's key handler returns false for terminal.paste, so xterm sends no ^V to the program
      expect(routeKey(map, k, false)).toEqual({ kind: "kolux", id: "terminal.paste" });
    }
  }
  // a split with panes A (first opened) and B (focused): the event lands on B's text area
  const areaA = new EventTarget();
  const areaB = new EventTarget();
  const sentA: string[] = [];
  const sentB: string[] = [];
  attachPaste(areaA, (t) => sentA.push(t), () => false);
  attachPaste(areaB, (t) => sentB.push(t), () => false);
  const e = paste(areaB, "echo from B");
  expect(sentB).toEqual(["echo from B"]);
  expect(sentA).toEqual([]); // never typed into pane A
  expect(e.defaultPrevented).toBe(true); // the browser's own insertion into a field is cancelled too
  paste(areaA, "echo from A"); // and the other way round
  expect(sentA).toEqual(["echo from A"]);
  expect(sentB).toEqual(["echo from B"]);
});
