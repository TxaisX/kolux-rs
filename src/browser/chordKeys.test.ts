// T-240 (BROW-035): the page script's key section (browser.rs CHORD_SCRIPT) is run against a stub page, so what ships is
// what is tested: Mod+C reaches the app only with nothing selected; every other chord and Mod+C with a selection are unchanged.
import { describe, expect, it } from "vitest";
import source from "../../src-tauri/src/browser.rs?raw";
const from = source.indexOf("let keys = [{ c: 1, k: \"Tab\" }");
const to = source.indexOf("// T-239 (BROW-017): a right-click", from);
const section = source.slice(from, to);

type Page = { selection?: string; field?: [number, number] | "throws" };

/** Presses Ctrl+<key> on a stub page; returns the sends the script made and whether it cancelled the press. */
function press(page: Page, keys: unknown[] | null, key = "c", flags: { shiftKey?: boolean; repeat?: boolean } = {}) {
  const sent: string[] = [];
  const listeners: ((e: unknown) => void)[] = [];
  const field =
    page.field === "throws"
      ? Object.defineProperty({}, "selectionStart", { get() { throw new Error("not selectable"); } })
      : page.field
        ? { selectionStart: page.field[0], selectionEnd: page.field[1] }
        : {};
  const win: Record<string, unknown> = {};
  const ctx = {
    window: win,
    document: { activeElement: field },
    getSelection: () => ({ isCollapsed: !page.selection, toString: () => page.selection ?? "" }),
    send: (w: string) => sent.push(w),
    addEventListener: (_t: string, h: (e: unknown) => void) => void listeners.push(h),
  };
  new Function("window", "document", "getSelection", "send", "addEventListener", section)(ctx.window, ctx.document, ctx.getSelection, ctx.send, ctx.addEventListener);
  if (keys) (win.__kxKeys as (l: unknown[]) => void)(keys);
  let cancelled = false;
  const e = { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, metaKey: false, altKey: false, shiftKey: !!flags.shiftKey, repeat: !!flags.repeat, defaultPrevented: false, preventDefault: () => void (cancelled = true), stopImmediatePropagation() {}, getModifierState: () => false };
  for (const h of listeners) h(e);
  return { sent, cancelled };
}

const grabKeys = [{ c: 1, k: "C", n: 1 }, { c: 1, k: "W" }];

describe("T-240 BROW-035: Mod+C in a page", () => {
  it("with nothing selected the app gets the press and the page does not", () => {
    const r = press({}, grabKeys);
    expect(r.cancelled).toBe(true);
    expect(r.sent).toEqual(["key?k=c&c=KeyC&m=c"]);
  });

  it("with text selected in the page, the page copies as usual", () => {
    const r = press({ selection: "some words" }, grabKeys);
    expect(r.cancelled).toBe(false);
    expect(r.sent).toEqual([]);
  });

  it("with text selected inside a field, the page copies as usual; an empty field selection still grabs", () => {
    expect(press({ field: [2, 6] }, grabKeys).sent).toEqual([]);
    expect(press({ field: [3, 3] }, grabKeys).sent).toEqual(["key?k=c&c=KeyC&m=c"]);
    expect(press({ field: "throws" }, grabKeys).sent).toEqual(["key?k=c&c=KeyC&m=c"]);
  });

  it("until the app hands in its chords, Mod+C stays the page's; other chords ignore the selection", () => {
    expect(press({}, null).sent).toEqual([]);
    expect(press({ selection: "x" }, grabKeys, "w").sent).toEqual(["key?k=w&c=KeyW&m=c"]);
    expect(press({}, grabKeys, "c", { shiftKey: true }).sent).toEqual([]);
    const held = press({}, grabKeys, "c", { repeat: true });
    expect(held.cancelled).toBe(true);
    expect(held.sent).toEqual([]);
  });
});
