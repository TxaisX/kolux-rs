import { describe, expect, test } from "vitest";
import type { Platform } from "./actions";
import { matchEvent, resolve, type KeyLike } from "./keymap";
import { scopesFor, type KeySurface } from "./keyScopes";
import { heldByTerminal } from "./terminalPolicy";

// APP-013: Ctrl+Tab switches tabs wherever focus sits. The Ctrl key is the Control key on every
// platform (on a Mac Cmd+Tab belongs to the system), so one chord covers all three.
const press = (o: Partial<KeyLike> = {}): KeyLike => ({ key: "Tab", code: "Tab", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, ...o });
const platforms: Platform[] = ["win32", "linux", "darwin"];
const surfaces: Array<[string, KeySurface]> = [
  ["terminal", { screen: "terminals", inTree: false }],
  ["agent", { screen: "terminals", inTree: false }],
  ["browser", { screen: "terminals", kind: "browser", inTree: false }],
  ["editor", { screen: "terminals", kind: "editor", inTree: false }],
  ["diff", { screen: "terminals", kind: "diff", inTree: false }],
  ["preview", { screen: "terminals", kind: "preview", inTree: false }],
  ["changes", { screen: "terminals", kind: "changes", inTree: false }],
  ["explorer tree", { screen: "terminals", inTree: true }],
  ["explorer tree beside an editor", { screen: "terminals", kind: "editor", inTree: true }],
];

describe("APP-013 tab keys from every focus", () => {
  for (const platform of platforms) {
    for (const [name, s] of surfaces) {
      test(`${platform}: Ctrl+Tab steps the recent-tab list from ${name}`, () => {
        const map = resolve(null, platform);
        expect(matchEvent(map, press(), scopesFor(s))?.id).toBe("tab.previousRecent");
        expect(matchEvent(map, press({ shiftKey: true }), scopesFor(s))?.id).toBe("tab.nextRecent");
      });
    }
  }

  test("the tab-number chord follows the platform: Alt+2 on Windows and Linux, Ctrl+2 on a Mac", () => {
    const digit = (o: Partial<KeyLike>) => press({ key: "2", code: "Digit2", ...o });
    for (const [name, s] of surfaces) {
      expect(matchEvent(resolve(null, "win32"), digit({ ctrlKey: false, altKey: true }), scopesFor(s))?.index, name).toBe(2);
      expect(matchEvent(resolve(null, "linux"), digit({ ctrlKey: false, altKey: true }), scopesFor(s))?.index, name).toBe(2);
      expect(matchEvent(resolve(null, "darwin"), digit({}), scopesFor(s))?.index, name).toBe(2);
    }
  });

  test("a plain Tab or Alt+Tab never matches a tab command", () => {
    const map = resolve(null, "win32");
    for (const [, s] of surfaces) {
      expect(matchEvent(map, press({ ctrlKey: false }), scopesFor(s))?.id ?? "").not.toMatch(/^tab\./);
      expect(matchEvent(map, press({ ctrlKey: false, altKey: true }), scopesFor(s))).toBeNull();
    }
  });

  test("with Terminal first the chord still reaches the window, because the command is marked terminal-safe", () => {
    const t = { closest: (sel: string) => (sel === ".xterm" ? {} : null) } as unknown as Element; // a node inside an xterm view
    expect(heldByTerminal("tab.previousRecent", { terminalShortcuts: "terminal" }, t)).toBe(false);
    expect(heldByTerminal("tab.nextRecent", { terminalShortcuts: "terminal" }, t)).toBe(false);
  });

  test("the surfaces keep the scopes they had before the tree was added", () => {
    expect(scopesFor({ screen: "terminals", inTree: false })).toEqual(["global", "terminal", "tabs"]);
    expect(scopesFor({ screen: "terminals", kind: "editor", inTree: false })).toEqual(["editor", "global", "tabs"]);
    expect(scopesFor({ screen: "terminals", kind: "preview", inTree: false })).toEqual(["global", "tabs"]);
    expect(scopesFor({ screen: "settings", inTree: false })).toEqual(["global"]);
  });
});
