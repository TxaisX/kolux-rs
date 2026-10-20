// CHAT-017 (T-327-b): Select All and Paste from the app menu act on the chat's message box.
import { describe, expect, it } from "vitest";
import { editChatBox, type BoxLike, type PageLike } from "./menuEdit";

function box(over: Partial<BoxLike> = {}) {
  const log: string[] = [];
  const b: BoxLike & { value: string } = {
    value: "hello world",
    selectionStart: 5,
    selectionEnd: 5,
    focus: () => void log.push("focus"),
    select: () => void log.push("select"),
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      log.push("range " + start + "-" + end);
    },
    dispatchEvent: (e) => (log.push("event " + e.type), true),
    ...over,
  };
  return { b, log };
}
const page = (b: BoxLike | null, active: unknown = null): PageLike => ({ activeElement: active, querySelector: () => b });
const later = () => new Promise((r) => setTimeout(r, 0));

describe("the Edit menu on the message box", () => {
  it("Select All focuses the box and selects its text", () => {
    const { b, log } = box();
    expect(editChatBox("selectAll", page(b), async () => "")).toBe(true);
    expect(log).toEqual(["focus", "select"]);
  });
  it("Paste puts the clipboard text at the cursor and tells the box it changed", async () => {
    const { b, log } = box();
    expect(editChatBox("paste", page(b), async () => " big")).toBe(true);
    await later();
    expect(b.value).toBe("hello big world");
    expect(log).toEqual(["focus", "range 5-5", "event input"]);
  });
  it("Paste replaces a selection, and an empty or unreadable clipboard changes nothing", async () => {
    const sel = box({ selectionStart: 0, selectionEnd: 5 });
    editChatBox("paste", page(sel.b), async () => "bye");
    await later();
    expect(sel.b.value).toBe("bye world");
    const empty = box();
    editChatBox("paste", page(empty.b), async () => "");
    editChatBox("paste", page(empty.b), () => Promise.reject(new Error("denied")));
    await later();
    expect(empty.b.value).toBe("hello world");
  });
  it("is the page's to handle when no box shows, another field or a terminal has the focus", () => {
    const { b } = box();
    expect(editChatBox("selectAll", page(null), async () => "")).toBe(false);
    expect(editChatBox("selectAll", page(b, { tagName: "INPUT" }), async () => "")).toBe(false);
    expect(editChatBox("paste", page(b, { tagName: "DIV", isContentEditable: true }), async () => "x")).toBe(false);
    expect(editChatBox("selectAll", page(b, { tagName: "TEXTAREA", closest: (s: string) => (s === ".xterm" ? {} : null) }), async () => "")).toBe(false);
    expect(editChatBox("selectAll", page(box({ checkVisibility: () => false }).b), async () => "")).toBe(false);
  });
  it("acts when the focus is already in the box or on the page body", () => {
    const { b, log } = box();
    expect(editChatBox("selectAll", page(b, b), async () => "")).toBe(true);
    expect(editChatBox("selectAll", page(b, { tagName: "BODY" }), async () => "")).toBe(true);
    expect(log.filter((x) => x === "select").length).toBe(2);
  });
});
