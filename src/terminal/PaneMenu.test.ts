// TERM-035 / TERM-025 / TERM-013: which items the pane menu offers and in what order, that Equalize
// and the rest appear only when they apply, Close Pane reads as destructive, the opening click does
// not dismiss, and the menu stays on screen.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import PaneMenu, { chooseItem, fitIn, OPEN_GUARD_MS, outsideDismisses, paneMenuItems, type MenuContext } from "./PaneMenu";

const noop = () => {};
/** A pane that can do everything and is split, expandable, selected, titled, with an agent action. */
const full: MenuContext = {
  selected: true,
  expanded: false,
  canExpand: true,
  onCopy: noop,
  onSelectAll: noop,
  onPaste: noop,
  agentActions: [{ id: "review", name: "Review plan", run: noop }],
  onSplit: noop,
  onEqualize: noop,
  onExpand: noop,
  onSetTitle: noop,
  hasTitle: true,
  onClearTitle: noop,
  copyIds: [
    { id: "idSession", name: "Copy Session ID", run: noop },
    { id: "idTerminal", name: "Copy Terminal ID", run: noop },
    { id: "idPane", name: "Copy Pane ID", run: noop },
  ],
  onDiagnostics: noop,
  onClose: noop,
  onClear: noop,
  onFind: noop,
};
const names = (c: MenuContext) => paneMenuItems(c).map((i) => i.name);
const html = (c: MenuContext) => renderToString(createElement(PaneMenu, { style: {}, items: paneMenuItems(c), onDismiss: noop }));

test("TERM-035: the menu lists Copy, Select All, Paste; agent actions; splits, Equalize, Expand; title; ids; diagnostics; Close; Clear Screen, in that order", () => {
  expect(names(full)).toEqual([
    "Copy", "Select All", "Paste",
    "Review plan",
    "Split Right", "Split Down", "Equalize", "Expand",
    "Set Title…", "Clear Title", "Copy Session ID", "Copy Terminal ID", "Copy Pane ID", "Copy terminal diagnostics",
    "Close Pane", "Clear Screen", "Find…",
  ]);
});

test("TERM-035: in an unsplit pane the menu has no Equalize item", () => {
  expect(names({ ...full, onEqualize: undefined })).not.toContain("Equalize");
  expect(names(full)).toContain("Equalize");
});

test("TERM-035: items appear only when they apply (Copy needs a selection, Clear Title a title, Expand room, Close a way to close)", () => {
  const bare = names({ ...full, selected: false, hasTitle: false, canExpand: false, onClose: undefined, onSplit: undefined, agentActions: [], copyIds: [] });
  expect(bare).not.toContain("Copy");
  expect(bare).not.toContain("Clear Title");
  expect(bare).not.toContain("Expand");
  expect(bare).not.toContain("Close Pane");
  expect(bare).not.toContain("Split Right");
  expect(bare).toContain("Select All");
  expect(bare).toContain("Paste");
  expect(bare).toContain("Clear Screen");
});

test("TERM-013: an expanded pane's menu offers Collapse; a lone classic pane has no Expand item", () => {
  expect(names({ ...full, expanded: true })).toContain("Collapse");
  expect(names({ ...full, expanded: true })).not.toContain("Expand");
  expect(names({ ...full, canExpand: false })).not.toContain("Expand");
});

test("TERM-035: Close Pane is styled destructive and no other item is; shortcuts show only when assigned", () => {
  const items = paneMenuItems(full);
  expect(items.filter((i) => i.danger).map((i) => i.name)).toEqual(["Close Pane"]);
  const out = html(full);
  const close = out.split("<button").find((b) => b.includes("Close Pane"))!;
  expect(close).toContain("danger");
  expect(close).toContain("Ctrl+W");
  // Set Title has no default chord: no shortcut text beside it.
  const title = out.split("<button").find((b) => b.includes("Set Title"))!;
  expect(title).not.toContain('class="muted"');
  expect(out).toContain('role="separator"');
});

test("TERM-035: an item's action is what the menu offers for it", () => {
  const ran: string[] = [];
  const items = paneMenuItems({ ...full, onSplit: (d) => ran.push(`split ${d}`), onEqualize: () => ran.push("equalize"), onClose: () => ran.push("close") });
  for (const n of ["Split Right", "Split Down", "Equalize", "Close Pane"]) items.find((i) => i.name === n)!.run();
  expect(ran).toEqual(["split right", "split down", "equalize", "close"]);
});

test("FIX-1: clicking an item (the button's onClick path) closes the menu first, then runs the action; Close Pane included", () => {
  const order: string[] = [];
  const items = paneMenuItems({ ...full, onSplit: (d) => order.push(`split ${d}`), onEqualize: () => order.push("equalize"), onClose: () => order.push("close") });
  for (const n of ["Split Right", "Equalize", "Close Pane"]) chooseItem(items.find((i) => i.name === n)!, () => order.push("dismiss"));
  expect(order).toEqual(["dismiss", "split right", "dismiss", "equalize", "dismiss", "close"]);
  // The rendered button is wired to it: the menu markup holds one button per item.
  const out = renderToString(createElement(PaneMenu, { style: {}, items, onDismiss: noop }));
  expect(out.split("<button").length - 1).toBe(items.length);
});

test("TERM-035: the click that opened the menu does not close it; a later click does", () => {
  expect(outsideDismisses(1000, 1000)).toBe(false);
  expect(outsideDismisses(1000, 1000 + OPEN_GUARD_MS - 1)).toBe(false);
  expect(outsideDismisses(1000, 1000 + OPEN_GUARD_MS)).toBe(true);
});

test("TERM-035: a tall menu opened near the bottom or right edge is moved back inside the window", () => {
  expect(fitIn(900, 420, 1000)).toBe(572); // bottom edge: 1000 - 420 - 8
  expect(fitIn(1900, 240, 1920)).toBe(1672);
  expect(fitIn(100, 420, 1000)).toBe(100); // already fits
  expect(fitIn(-30, 420, 1000)).toBe(8); // never above the margin
  expect(fitIn(5, 2000, 1000)).toBe(8); // taller than the window: the top, then it scrolls
});
