// T-239 (BROW-018): app shortcuts keep working while the keyboard is inside a page. The page's own
// script (browser.rs CHORD_SCRIPT) swallows the chords listed here and reports each press once as a
// `browser-key` event; the pane then replays it on the window after its split takes focus, so the
// app's normal key handling runs, customised bindings included. Chords a page needs for its own
// editing stay with the page whatever the keymap says.
import { type Keymap, parseChord } from "../keys/keymap";

/** One chord as the page matches it: modifiers as flags, the key as the keymap names it; `i` for
 * the tab-number chord, which takes any digit 1-9. */
export type PageKey = { c?: 1; m?: 1; a?: 1; s?: 1; k: string; i?: 1 };

/** Editing chords the page keeps, whatever the keymap binds them to (browser.grabElement is Mod+C). */
export const PAGE_RESERVED = new Set(["Mod+C", "Mod+V", "Mod+X", "Mod+A", "Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+Shift+V", "Mod+Insert", "Shift+Insert"]);

/** The scopes whose chords a page forwards: the tab strip, the browser pane's own and the global ones. */
const SCOPES = new Set(["tabs", "browser", "global"]);

/** The chords the page forwards, from the live keymap (custom bindings count, dropped ones do not). */
export function pageKeys(map: Keymap): PageKey[] {
  const mac = map.platform === "darwin";
  const out: PageKey[] = [];
  const seen = new Set<string>();
  for (const b of map.bindings.values()) {
    if (!SCOPES.has(b.action.scope) || b.dropped) continue;
    for (const chord of b.chords) {
      if (PAGE_RESERVED.has(chord)) continue;
      const c = parseChord(chord);
      if ("error" in c) continue;
      const d: PageKey = { k: c.key };
      if (c.ctrl || (c.mod && !mac)) d.c = 1;
      if (c.meta || (c.mod && mac)) d.m = 1;
      if (c.alt) d.a = 1;
      if (c.shift) d.s = 1;
      if (b.action.index) d.i = 1;
      // a chord with no modifier would take plain typing from the page
      if (!d.c && !d.m && !d.a) continue;
      const key = JSON.stringify(d);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

/** The payload of a `browser-key` event: the key, its code and the modifiers held (c, m, a, s; g = AltGraph). */
export type KeyEvent = { id: number; k: string; c: string; m: string };

/** The keyboard event the pane replays on the window for a forwarded press. */
export function keyEventInit(p: KeyEvent): KeyboardEventInit {
  const m = p.m ?? "";
  return { key: p.k ?? "", code: p.c ?? "", ctrlKey: m.includes("c"), metaKey: m.includes("m"), altKey: m.includes("a"), shiftKey: m.includes("s"), modifierAltGraph: m.includes("g"), bubbles: true, cancelable: true };
}
