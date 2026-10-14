// SET-061 (T-323): which part of a menu the wheel scrolls.
import { describe, expect, it } from "vitest";
import { installMenuWheel, MENU_SELECTOR, onMenuWheel, pixels, wheelTarget, type Box, type El } from "./menuWheel";

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

// FIX-2 (council AFTER 3): no wheel listener on the whole document; only a popup the pointer or
// the focus reached carries one, so the page's own scrolling never waits on script.
type Fn = (e: unknown) => void;
const target = () => {
  const ls = new Map<string, { fn: Fn; opts: unknown }[]>();
  return {
    ls,
    addEventListener(t: string, fn: Fn, opts?: unknown) {
      ls.set(t, [...(ls.get(t) ?? []), { fn, opts }]);
    },
    removeEventListener(t: string, fn: Fn) {
      ls.set(t, (ls.get(t) ?? []).filter((l) => l.fn !== fn));
    },
    fire(t: string, e: unknown) {
      for (const l of ls.get(t) ?? []) l.fn(e);
    },
    count: (t: string) => (ls.get(t) ?? []).length,
  };
};
type Live = Fake & ReturnType<typeof target> & { isConnected: boolean };
const live = (o: Partial<Fake>, parent: Fake | null = null): Live => Object.assign(el(o, parent), target(), { isConnected: true }) as Live;

describe("FIX-2 the wheel rule listens only on popups that were reached", () => {
  it("the document never gets a wheel listener; a popup gets one, once, when the pointer enters it", () => {
    const doc = target();
    const stop = installMenuWheel(doc, style);
    expect(doc.count("wheel")).toBe(0);
    expect(doc.count("pointerover")).toBe(1);
    expect(doc.count("focusin")).toBe(1);

    const page = live({ overflowY: "auto", scrollHeight: 2000, clientHeight: 600 });
    const runs = live({ role: "listbox" }, page);
    doc.fire("pointerover", { target: el({ role: "option" }, runs) });
    expect(page.count("wheel") + runs.count("wheel")).toBe(0);

    const menu = live({ role: "menu" });
    const list = el({ overflowY: "auto", scrollHeight: 900, clientHeight: 200 }, menu);
    const row = el({}, list);
    doc.fire("pointerover", { target: row });
    doc.fire("pointerover", { target: list });
    expect(menu.count("wheel")).toBe(1);
    expect(menu.ls.get("wheel")?.[0].opts).toEqual({ passive: false });
    const e = wheel(row, 100);
    menu.fire("wheel", e);
    expect(e.defaultPrevented).toBe(true);
    expect(list.scrollTop).toBe(100);

    // a picker reached by the keyboard is armed too; a closed popup's listener is dropped
    const picker = live({ cls: ["picker"] });
    menu.isConnected = false;
    doc.fire("focusin", { target: el({}, picker) });
    expect(picker.count("wheel")).toBe(1);
    expect(menu.count("wheel")).toBe(0);

    stop();
    expect(doc.count("pointerover") + doc.count("focusin") + picker.count("wheel")).toBe(0);
  });
});
