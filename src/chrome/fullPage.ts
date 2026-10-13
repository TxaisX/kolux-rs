// VIEW-009: a full page (Tasks, Settings, Inbox, Artifacts...) fills the workspace area. Escape
// first closes any menu, popover or dialog that is showing; only when none is does it leave the
// page. Overlays that are hidden do not count.
import { useEffect, useRef } from "react";

const OVERLAYS = '.menu, [role="menu"], [role="dialog"], .pick-list, .font-list, .popover, .palette';

/** Whether a menu, popover or dialog is showing under `root` (one with no box on screen is hidden). */
export function overlayShowing(root: ParentNode = document): boolean {
  return [...root.querySelectorAll(OVERLAYS)].some((el) => (el as HTMLElement).getClientRects().length > 0 && !(el as HTMLElement).closest("[hidden]"));
}

/** While `on`, an Escape nothing else used leaves the page. */
export function useEscapeLeaves(on: boolean, leave: () => void): void {
  const go = useRef(leave);
  go.current = leave;
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || overlayShowing()) return;
      go.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [on]);
}
