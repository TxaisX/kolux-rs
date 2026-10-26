// TERM-065 acceptance: copy never lies. The real key router decides which chords copy, the real copySelection decides
// what is said; the pane shows whatever notice copySelection hands it (TerminalPane setFlash) and keeps the selection.
import { expect, test } from "vitest";
import { resolve, type KeyLike } from "../../keys/keymap";
import { copySelection } from "../copy";
import { routeKey } from "../shellKeys";

const press = (k: Partial<KeyLike>): KeyLike => ({ key: "c", code: "KeyC", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });
const win = resolve(null, "win32");
const linux = resolve(null, "linux");

function term(text: string) {
  return { cleared: 0, focused: 0, hasSelection: () => text.length > 0, getSelection: () => text, focus() { this.focused++; } };
}

test("box 1: a copy chord with a selection reaches copySelection; a locked clipboard then shows one failure notice and the selection stays", async () => {
  expect(routeKey(win, press({ key: "C", ctrlKey: true, shiftKey: true }), true)).toEqual({ kind: "kolux", id: "terminal.copySelection" });
  expect(routeKey(linux, press({ key: "C", ctrlKey: true, shiftKey: true }), true)).toEqual({ kind: "kolux", id: "terminal.copySelection" });
  expect(routeKey(win, press({ ctrlKey: true }), true)).toEqual({ kind: "kolux", id: "terminal.copySelection" });
  const t = term("build output");
  const shown: string[] = [];
  const locked = async () => {
    throw new Error("Write permission denied");
  };
  const out = await copySelection(t, locked, (m) => shown.push(m), () => 100_000, { lastNotice: 0 });
  expect(out).toBe("failed");
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatch(/refused the copy/);
  expect(shown[0]).toMatch(/selection is still here/);
  expect(t.hasSelection()).toBe(true); // nothing in the copy path clears it
  expect(t.getSelection()).toBe("build output");
  expect(t.focused).toBe(1);
});

test("box 2: copying with nothing selected never reports success (no notice, no clipboard write); Ctrl+C then is the interrupt", async () => {
  // with nothing selected Ctrl+C is not a copy: it goes to the program; Ctrl+Shift+C reaches copySelection, which says nothing
  expect(routeKey(win, press({ ctrlKey: true }), false)).toEqual({ kind: "shell" });
  expect(routeKey(win, press({ key: "C", ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.copySelection" });
  const t = term("");
  const notes: string[] = [];
  let writes = 0;
  const out = await copySelection(t, async () => void writes++, (m) => notes.push(m));
  expect(out).toBe("empty");
  expect(notes).toEqual([]);
  expect(writes).toBe(0);
  // also when the clipboard would have failed: an empty selection never gets as far as the clipboard
  const failing = await copySelection(t, async () => { throw new Error("locked"); }, (m) => notes.push(m), () => 1, { lastNotice: 0 });
  expect(failing).toBe("empty");
  expect(notes).toEqual([]);
});
