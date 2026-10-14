// VIEW-009: a full page (Tasks, Settings, Inbox, Artifacts...) fills the workspace area. Escape
// first closes any menu, popover or dialog that is showing; only when none is does it leave the
// page. Overlays that are hidden do not count. An Escape typed in a text field stays there (T-146-f).
import { useEffect, useRef } from "react";

const OVERLAYS = '.menu, [role="menu"], [role="dialog"], .pick-list, .font-list, .popover, .palette';

/** Whether a menu, popover or dialog is showing under `root` (one with no box on screen is hidden). */
export function overlayShowing(root: ParentNode = document): boolean {
  return [...root.querySelectorAll(OVERLAYS)].some((el) => (el as HTMLElement).getClientRects().length > 0 && !(el as HTMLElement).closest("[hidden]"));
}

// Input types that take no typed text: an Escape on one of them may still leave the page.
const NO_TEXT = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

/** T-146-f: whether a key event's target is somewhere the user types text (an input, a textarea, or
 *  anything contenteditable), where Escape belongs to the field and never leaves the page. */
export function inTextField(t: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === "TEXTAREA") return true;
  return t.tagName === "INPUT" && !NO_TEXT.has((t.type ?? "").toLowerCase());
}

/** While `on`, an Escape nothing else used leaves the page. */
export function useEscapeLeaves(on: boolean, leave: () => void): void {
  const go = useRef(leave);
  go.current = leave;
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || inTextField(e.target as HTMLElement | null) || overlayShowing()) return;
      go.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [on]);
}
