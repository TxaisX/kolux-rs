import { expect, test } from "vitest";
import { inTextField, overlayShowing } from "./fullPage";

/** A stand-in element: on screen when it has boxes, and inside a [hidden] parent or not. */
const el = (boxes: number, underHidden = false) => ({ getClientRects: () => ({ length: boxes }), closest: () => (underHidden ? {} : null) });
const root = (...els: unknown[]) => ({ querySelectorAll: () => els }) as unknown as ParentNode;

test("VIEW-009: Escape leaves the page only when no menu, popover or dialog is showing; hidden ones do not count", () => {
  expect(overlayShowing(root())).toBe(false);
  expect(overlayShowing(root(el(1)))).toBe(true);
  expect(overlayShowing(root(el(0))), "display:none").toBe(false);
  expect(overlayShowing(root(el(1, true))), "inside [hidden]").toBe(false);
});

/** A stand-in event target: a tag, an input type, and whether it (or a parent) is contenteditable. */
const target = (tagName: string, type = "", editable = false) => ({ tagName, type, isContentEditable: editable });

test("T-146-f: an Escape typed in a text field stays in the field and never leaves the page", () => {
  expect(inTextField(target("INPUT", "text")), "text input").toBe(true);
  expect(inTextField(target("INPUT", "search")), "search input").toBe(true);
  expect(inTextField(target("TEXTAREA")), "textarea").toBe(true);
  expect(inTextField(target("DIV", "", true)), "contenteditable").toBe(true);
  expect(inTextField(target("INPUT", "checkbox")), "a checkbox takes no text").toBe(false);
  expect(inTextField(target("INPUT", "range")), "a slider takes no text").toBe(false);
  expect(inTextField(target("BUTTON")), "button").toBe(false);
  expect(inTextField(target("DIV")), "plain page").toBe(false);
  expect(inTextField(null), "no target").toBe(false);
});
