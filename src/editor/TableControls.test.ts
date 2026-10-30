// T-620: the table's cell menu still closes on a press outside it now that the whole top bar is a drag region.
// Tauri's drag script (tauri 2.12, window/scripts/drag.js) stops the mousedown of a press on a drag region at
// the document, before it reaches the window, so the menu listens for pointerdown, which the script leaves alone.
import { expect, test } from "vitest";
import { watchMenuClose } from "./TableControls";

const event = (type: string, extra: object = {}) => Object.assign(new Event(type), extra);

test("a press anywhere closes the cell menu, and so does Escape; once it is gone nothing listens", () => {
  const win = new EventTarget();
  let closed = 0;
  const stop = watchMenuClose(win as unknown as Window, () => closed++);
  win.dispatchEvent(event("pointerdown"));
  expect(closed, "a pointerdown outside the menu closes it").toBe(1);
  win.dispatchEvent(event("keydown", { key: "Escape" }));
  expect(closed, "Escape closes it").toBe(2);
  win.dispatchEvent(event("keydown", { key: "a" }));
  expect(closed, "other keys leave it open").toBe(2);
  stop();
  win.dispatchEvent(event("pointerdown"));
  win.dispatchEvent(event("keydown", { key: "Escape" }));
  expect(closed, "after the menu closes nothing is listening").toBe(2);
});
