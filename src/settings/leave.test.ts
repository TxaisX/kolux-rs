// @vitest-environment node
import { expect, test } from "vitest";
import { bindLeave } from "./leave";

const fakeWindow = () => {
  const on = new Map<string, Set<() => void>>();
  return {
    on,
    addEventListener: (t: string, f: () => void) => void (on.get(t) ?? on.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: () => void) => void on.get(t)?.delete(f),
    fire: (t: string) => on.get(t)?.forEach((f) => f()),
  };
};

test("SET-036 (row 502): a field's save runs when the window closes and once more when its page goes away", () => {
  const win = fakeWindow();
  let saves = 0;
  const off = bindLeave(win, () => saves++);
  win.fire("beforeunload");
  expect(saves).toBe(1);
  win.fire("pagehide");
  expect(saves).toBe(2);
  off(); // the page unmounts: no blur comes, so this is the save
  expect(saves).toBe(3);
  win.fire("beforeunload");
  expect(saves).toBe(3);
  expect([...win.on.values()].every((s) => s.size === 0)).toBe(true);
});

// Every settings field that saves "on leaving the field" (an onBlur of its own) must also save when the page
// goes away, through useLeaveSave or useDraft: a removed input fires no blur, so the typed value was lost.
const sources = import.meta.glob<string>("./*.tsx", { query: "?raw", import: "default", eager: true });

test("SET-036 (row 502): no settings page saves on blur alone", () => {
  const blurOnly = Object.entries(sources)
    .filter(([, src]) => /onBlur=\{/.test(src) && !/useLeaveSave\(/.test(src) && !/useDraft\(/.test(src))
    .map(([file]) => file);
  expect(blurOnly).toEqual([]);
  expect(Object.keys(sources).length).toBeGreaterThan(10);
});
