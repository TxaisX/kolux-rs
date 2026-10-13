import { expect, test } from "vitest";
import { overlayShowing } from "./fullPage";

/** A stand-in element: on screen when it has boxes, and inside a [hidden] parent or not. */
const el = (boxes: number, underHidden = false) => ({ getClientRects: () => ({ length: boxes }), closest: () => (underHidden ? {} : null) });
const root = (...els: unknown[]) => ({ querySelectorAll: () => els }) as unknown as ParentNode;

test("VIEW-009: Escape leaves the page only when no menu, popover or dialog is showing; hidden ones do not count", () => {
  expect(overlayShowing(root())).toBe(false);
  expect(overlayShowing(root(el(1)))).toBe(true);
  expect(overlayShowing(root(el(0))), "display:none").toBe(false);
  expect(overlayShowing(root(el(1, true))), "inside [hidden]").toBe(false);
});
