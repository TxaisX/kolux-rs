// T-612 (PLAN.md T-566, Tip part): on a relaunch the Tip stayed open through ten presses of the prover's close (an Escape
// sent to the window, live-common.mjs dismissFirstRun; evidence/T-544.txt), while its "Not now" closed it. The card never
// takes the keyboard (tipView.test.ts), so its own Escape handler only heard a key pressed inside it. Escape now closes
// the tip from wherever the keyboard is, unless a modal dialog is up, whose Escape it is. Review round 1: it closes the
// tip without taking the key, so the same Escape still closes the palette, Settings or a menu, and still reaches a focused
// terminal (in Claude Code, Escape interrupts the running agent).
import { expect, test } from "vitest";
import { tipEscape } from "./Guides";

test("T-612: Escape closes the tip wherever the keyboard is and still reaches the palette, Settings, a menu or the terminal; a modal dialog's Escape, a composition and other keys are left alone", () => {
  const added: { f: (e: never) => void; capture: boolean }[] = [];
  const win = { addEventListener: (_t: "keydown", f: (e: never) => void, capture: boolean) => void added.push({ f, capture }), removeEventListener: (_t: "keydown", f: (e: never) => void) => void added.splice(added.findIndex((a) => a.f === f), 1) };
  let modal = false;
  let closed = 0;
  const off = tipEscape(win, () => modal, () => closed++);
  expect(added).toHaveLength(1);
  expect(added[0].capture).toBe(true); // ahead of a focused terminal, as the wizard's Escape (ONB-006)
  const press = (over: Record<string, unknown> = {}) => {
    const e = { key: "Escape", isComposing: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...over };
    added[0].f(e as never);
    return e;
  };
  const e = press(); // pressed in the terminal pane, not in the card
  expect(closed).toBe(1);
  expect(e.prevented || e.stopped).toBe(false); // the same press goes on to the palette, Settings, a menu or the terminal program
  press({ isComposing: true });
  press({ key: "Enter" });
  expect(closed).toBe(1);
  modal = true; // an aria-modal dialog or an alertdialog (a question) is up: its Escape, the tip stays
  const m = press();
  expect(m.prevented || m.stopped).toBe(false);
  expect(closed).toBe(1);
  off();
  expect(added).toHaveLength(0);
});
