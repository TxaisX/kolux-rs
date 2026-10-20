// Native chat, the app menu's Edit items on the message box (CHAT-017; T-327-b): "Select All and Paste from the app
// menu act on the box". When the chat's box is on the page and the user's focus is not in some other text field or
// a terminal, Select All selects the box's text and Paste puts the clipboard's text at its cursor. Anything else is
// left to the page's existing handling (a field's own edit, the focused terminal), which this returns false for.
export type BoxEdit = "selectAll" | "paste";

/** The few things of the message box this file uses (a textarea has all of them). */
export type BoxLike = {
  focus: () => void;
  select: () => void;
  selectionStart: number | null;
  selectionEnd: number | null;
  setRangeText: (text: string, start: number, end: number, mode: "end") => void;
  dispatchEvent: (e: Event) => boolean;
  checkVisibility?: () => boolean;
};
export type PageLike = { activeElement: unknown; querySelector: (selector: string) => BoxLike | null };

export const BOX_SELECTOR = "textarea.chat-box";

/** A field (other than the box) or a terminal holds the focus: the menu item is for that, not for the chat. */
const elsewhere = (active: unknown, box: BoxLike) => {
  const a = active as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null;
  if (!a || a === (box as unknown)) return false;
  if (a.closest?.(".xterm")) return true;
  return a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable === true;
};

/** Does the menu item go to the chat's box? True when it did (Paste finishes once the clipboard is read; a clipboard that
 * cannot be read leaves the box as it was), false when the page should handle the item itself. */
export function editChatBox(op: BoxEdit, page: PageLike, read: () => Promise<string>): boolean {
  const box = page.querySelector(BOX_SELECTOR);
  if (!box || (box.checkVisibility && !box.checkVisibility()) || elsewhere(page.activeElement, box)) return false;
  box.focus();
  if (op === "selectAll") {
    box.select();
    return true;
  }
  read().then(
    (text) => {
      if (!text) return;
      const start = box.selectionStart ?? 0;
      box.setRangeText(text, start, box.selectionEnd ?? start, "end");
      box.dispatchEvent(new Event("input", { bubbles: true })); // the box's own change handler keeps the draft
    },
    () => {},
  );
  return true;
}
