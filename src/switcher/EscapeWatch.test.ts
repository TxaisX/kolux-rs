import { afterEach, expect, test, vi } from "vitest";

// FIX-3 (review FIX-SOON 2): the effect inside EscapeWatch is the wiring that matters (window, not document:
// a document listener sits in the bubble path, after a focused pane has already seen the key). renderToString
// never runs effects and there is no jsdom, so useEffect is replaced by "run now, keep the cleanup".
const cleanups: Array<() => void> = [];
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useEffect: (fn: () => void | (() => void)) => {
    const stop = fn();
    if (stop) cleanups.push(stop);
  },
}));

import { EscapeWatch } from "./AccountSwitcher";

const fakeTarget = () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() });

afterEach(() => {
  cleanups.length = 0;
  vi.unstubAllGlobals();
});

test("FIX-3: EscapeWatch listens on window, not document, and removes that same registration", () => {
  const win = fakeTarget();
  const doc = fakeTarget();
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  const onClose = vi.fn();
  EscapeWatch({ onClose });
  expect(win.addEventListener).toHaveBeenCalledTimes(1);
  expect(doc.addEventListener).not.toHaveBeenCalled();
  const [type, fn, opts] = win.addEventListener.mock.calls[0];
  expect(type).toBe("keydown");
  expect(opts).toEqual({ capture: true });
  expect(cleanups).toHaveLength(1);
  cleanups[0]();
  expect(win.removeEventListener).toHaveBeenCalledWith("keydown", fn, { capture: true });
  expect(doc.removeEventListener).not.toHaveBeenCalled();
  // the registered listener is the one that closes the menu
  fn({ key: "Escape", stopPropagation: vi.fn(), preventDefault: vi.fn() });
  expect(onClose).toHaveBeenCalledTimes(1);
});
