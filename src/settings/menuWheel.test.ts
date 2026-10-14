// SET-061 (T-323): which part of a menu the wheel scrolls.
import { describe, expect, it } from "vitest";
import { MENU_SELECTOR, onMenuWheel, pixels, wheelTarget, type Box, type El } from "./menuWheel";

const b = (overflowY: string, scrollTop: number, scrollHeight: number, clientHeight: number, parent: Box | null = null): Box => ({ overflowY, scrollTop, scrollHeight, clientHeight, parent });

describe("SET-061 wheel in menus", () => {
  it("the closest list that can scroll that way moves, not the menu or what is behind", () => {
    const menu = b("visible", 0, 300, 300);
    const list = b("auto", 0, 900, 200, menu);
    const row = b("visible", 0, 20, 20, list);
    expect(wheelTarget(row, 100)).toBe(list);
    expect(wheelTarget(row, -100)).toBeNull();
  });

  it("a list at its end passes the wheel out to a menu that can still scroll", () => {
    const menu = b("auto", 0, 800, 300);
    const list = b("auto", 700, 900, 200, menu);
    expect(wheelTarget(list, 50)).toBe(menu);
  });

  it("clipping and sideways-only parts are passed over; a short menu moves nothing", () => {
    const menu = b("hidden", 0, 900, 200);
    const side = b("visible", 0, 50, 50, menu);
    expect(wheelTarget(side, 100)).toBeNull();
    const short = b("auto", 0, 150, 150);
    expect(wheelTarget(short, 100)).toBeNull();
  });

  it("line and page wheels count in pixels", () => {
    expect(pixels(3, 1)).toBe(48);
    expect(pixels(1, 2, 400)).toBe(400);
    expect(pixels(30, 0)).toBe(30);
  });
});

// Council FB 3: a stand-in element tree whose closest() reads MENU_SELECTOR itself, so the real
// selector text is what decides which surfaces the rule covers.
type Fake = El & { role?: string; cls: string[]; popup?: boolean; overflowY: string; parentElement: Fake | null };
const one = (x: Fake, sel: string): boolean => {
  if (sel.startsWith(".")) return x.cls.includes(sel.slice(1));
  const m = /^\[role="(\w+)"\](\[data-popup\])?$/.exec(sel);
  if (!m) throw new Error(`the stand-in cannot read ${sel}`);
  return x.role === m[1] && (!m[2] || !!x.popup);
};
const el = (o: Partial<Fake>, parent: Fake | null = null): Fake => {
  const n: Fake = {
    cls: [],
    overflowY: "visible",
    scrollTop: 0,
    scrollHeight: 20,
    clientHeight: 20,
    ...o,
    parentElement: parent,
    closest(sel: string) {
      for (let x: Fake | null = n; x; x = x.parentElement) if (sel.split(",").some((s) => one(x as Fake, s.trim()))) return x;
      return null;
    },
  };
  return n;
};
const wheel = (target: unknown, deltaY: number) => {
  const e = { target, deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, defaultPrevented: false, preventDefault: () => (e.defaultPrevented = true) };
  return e;
};
const style = (x: El) => ({ overflowY: (x as Fake).overflowY });

describe("SET-061 only floating surfaces take the wheel", () => {
  it("the wheel over an inline listbox is left to the page that scrolls it", () => {
    const page = el({ cls: ["autos-detail"], overflowY: "auto", scrollHeight: 2000, clientHeight: 600 });
    const runs = el({ cls: ["autos-runs"], role: "listbox" }, page);
    const row = el({ role: "option" }, runs);
    const e = wheel(row, 100);
    onMenuWheel(e, style);
    expect(e.defaultPrevented).toBe(false);
    expect(page.scrollTop).toBe(0);
  });

  it("a listbox marked as a popup, a menu and a picker still take it", () => {
    for (const surface of [{ role: "listbox", popup: true }, { role: "menu" }, { cls: ["picker"] }]) {
      const pop = el({ cls: [], ...surface });
      const list = el({ overflowY: "auto", scrollHeight: 900, clientHeight: 200 }, pop);
      const row = el({}, list);
      const e = wheel(row, 100);
      onMenuWheel(e, style);
      expect(e.defaultPrevented).toBe(true);
      expect(list.scrollTop).toBe(100);
    }
  });

  it("a target that is not an element (text, window) is ignored", () => {
    const e = wheel({}, 100);
    onMenuWheel(e, style);
    expect(e.defaultPrevented).toBe(false);
    expect(MENU_SELECTOR).not.toMatch(/\[role="listbox"\],/);
  });
});
