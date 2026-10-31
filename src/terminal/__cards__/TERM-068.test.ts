// TERM-068 acceptance box 1: with a split, Ctrl+V / Ctrl+Shift+V / Shift+Insert paste into the focused pane only.
// Box 2: a paste whose clipboard is read asynchronously (the click and menu routes, pasteFromClipboard) is
// cancelled when another pane takes focus while the read is still running, and still goes in when the same
// pane has focus back before the text arrives.
import { expect, test } from "vitest";
import { resolve, type KeyLike } from "../../keys/keymap";
import { attachPaste, pasteFromClipboard, type ClipboardRead } from "../paste";
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

// A clipboard read the test finishes by hand: it stands in for a read that takes long enough for the
// user to click another pane.
const deferred = <T,>() => {
  let finish: (value: T) => void = () => {};
  const p = new Promise<T>((r) => (finish = r));
  return { p, finish };
};

test("box 2: a pane switch while the clipboard is still being read cancels the paste; the same pane getting focus back does not", async () => {
  const typedA: string[] = [];
  const typedB: string[] = [];
  let focused = "A";
  // Each pane has its own paste route, as each pane in the window has its own pasteFromClipboard call.
  const route = (pane: string) => {
    const text = deferred<string>();
    const typed = pane === "A" ? typedA : typedB;
    const d: ClipboardRead<string> = {
      read: () => text.p,
      image: async () => null,
      pasteText: (t) => typed.push(t),
      pasteImage: (f) => typed.push(`image:${f}`),
      focused: () => focused === pane,
      refused: (e) => typed.push(`refused:${String(e)}`),
    };
    return { done: pasteFromClipboard(d), finish: text.finish };
  };
  // A starts the paste; while the clipboard is still being read the user switches to B.
  const a = route("A");
  focused = "B";
  a.finish("echo from A");
  expect(await a.done).toBe("cancelled");
  expect(typedA).toEqual([]); // nothing into the pane the paste was started from
  expect(typedB).toEqual([]); // and nothing into the pane that now has focus
  // A brief loss of focus during the read, with focus back on the same pane before the text arrives: it goes in.
  focused = "A";
  const again = route("A");
  focused = "B";
  focused = "A";
  again.finish("echo from A");
  expect(await again.done).toBe("text");
  expect(typedA).toEqual(["echo from A"]);
  expect(typedB).toEqual([]);
});

test("box 2: the image fallback is cancelled the same way when the pane changes while the image is being read", async () => {
  const typed: string[] = [];
  let focused = true;
  const image = deferred<string | null>();
  const d: ClipboardRead<string> = {
    read: async () => "", // no text on the clipboard, so the image is tried
    image: () => image.p,
    pasteText: (t) => typed.push(t),
    pasteImage: (f) => typed.push(`image:${f}`),
    focused: () => focused,
    refused: () => typed.push("refused"),
  };
  const done = pasteFromClipboard(d);
  focused = false; // the user moved to another pane during the image read
  image.finish("shot.png");
  expect(await done).toBe("cancelled");
  expect(typed).toEqual([]);
});
