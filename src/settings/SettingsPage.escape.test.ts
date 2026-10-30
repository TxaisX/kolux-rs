// T-565 (VIEW-009): Escape closes Settings wherever the keyboard was when Settings opened, and an
// Escape a dialog inside Settings uses closes only that dialog. Settings is drawn over the panes,
// which stay mounted: the terminal under it is stood in for by a field that, like xterm
// (CoreBrowserTerminal.cancel), sends a key it handles to the program and stops it there.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byText, click, type FakeDocument, FakeNode, find, installDom, mount, settle, until, withText } from "../tasks/fakeDom";
import type { SettingsTarget } from "./pages";

const h = vi.hoisted(() => ({ agents: [] as { id: string; installed: boolean }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "project_list") return Promise.resolve([]);
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "agent_list") return Promise.resolve(h.agents);
    if (cmd === "grok_status") return Promise.resolve({ connection: "none", keySaved: false, signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null });
    return Promise.reject("not stubbed");
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

type Listener = { fn: (e: unknown) => void; capture: boolean };
let doc: FakeDocument;
let onWindow: Record<string, Listener[]>;
let unmount: () => Promise<void> = async () => {};
const realFocus = FakeNode.prototype.focus;
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  onWindow = {};
  Object.assign(globalThis, { localStorage: dom.win.localStorage, requestAnimationFrame: () => 0, cancelAnimationFrame() {} });
  Object.assign(dom.win, {
    addEventListener: (t: string, fn: Listener["fn"], o?: boolean | { capture?: boolean }) => (onWindow[t] ??= []).push({ fn, capture: typeof o === "object" ? !!o.capture : !!o }),
    removeEventListener: (t: string, fn: Listener["fn"]) => (onWindow[t] = (onWindow[t] ?? []).filter((l) => l.fn !== fn)),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
  });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  // The keyboard goes where focus() puts it.
  FakeNode.prototype.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  h.agents = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  FakeNode.prototype.focus = realFocus;
});

/** A key pressed where the keyboard is, sent as a browser sends it: capture listeners from the window
 *  down to the target, then bubble listeners back up; a listener that stops it ends the trip there. */
async function press(key: string) {
  const target = doc.activeElement;
  const nodes: { listeners: Record<string, Listener[]> }[] = [{ listeners: onWindow }, doc];
  const up: FakeNode[] = [];
  for (let n: FakeNode | null = target; n; n = n.parentNode) up.unshift(n);
  nodes.push(...up);
  let stopped = false;
  let now = false;
  const ev = {
    type: "keydown",
    key,
    code: key,
    keyCode: key === "Escape" ? 27 : 0,
    which: key === "Escape" ? 27 : 0,
    target,
    srcElement: target,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    isTrusted: true,
    isComposing: false,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    timeStamp: Date.now(),
    getModifierState: () => false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    stopImmediatePropagation() {
      stopped = now = true;
    },
  };
  const run = (n: { listeners: Record<string, Listener[]> }, capture: boolean) => {
    for (const l of [...(n.listeners.keydown ?? [])]) if (l.capture === capture && !now) l.fn(ev);
  };
  await act(async () => {
    const last = nodes.length - 1;
    for (let i = 0; i < last && !stopped; i++) run(nodes[i], true);
    if (!stopped) run(nodes[last], true); // at the target: its capture listeners, then its others
    if (!stopped) run(nodes[last], false);
    for (let i = last - 1; i >= 0 && !stopped; i--) run(nodes[i], false);
  });
}

/** The focused terminal under Settings: what reaches it is what the program would get. */
function terminal() {
  const node = doc.createElement("textarea");
  doc.body.appendChild(node);
  const sent: string[] = [];
  node.addEventListener(
    "keydown",
    (e: unknown) => {
      const k = e as { key: string; preventDefault(): void; stopPropagation(): void };
      sent.push(k.key);
      k.preventDefault();
      k.stopPropagation();
    },
    true,
  );
  node.focus();
  return { node, sent };
}

async function open(onClose: () => void, target: SettingsTarget | null = null) {
  const { default: SettingsPage } = await import("./SettingsPage");
  const m = await mount(createElement(SettingsPage, { onClose, target, n: target ? 1 : 0 }), doc);
  unmount = m.unmount;
  await until(() => find(m.container, (n) => /settings-link/.test(n.attrs.class ?? "")).length >= 10, "the side list");
  await settle();
  return m;
}

test("Settings opened from a terminal takes the keyboard: Escape closes it and never reaches the terminal", async () => {
  const term = terminal();
  const closed = vi.fn();
  await open(closed);
  await press("Escape");
  expect(term.sent).toEqual([]);
  expect(closed).toHaveBeenCalledTimes(1);
});

test("Escape with the keyboard on a control inside Settings closes Settings", async () => {
  terminal();
  const closed = vi.fn();
  const m = await open(closed);
  byText(m.container, "button", "Appearance")[0].focus();
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});

test("closing Settings gives the keyboard back to the terminal it was opened from", async () => {
  const term = terminal();
  await open(() => {});
  expect(doc.activeElement).not.toBe(term.node);
  await unmount();
  unmount = async () => {};
  expect(doc.activeElement).toBe(term.node);
});

test("Escape in the xAI key dialog inside Settings closes only that dialog; the next one closes Settings", async () => {
  h.agents = [{ id: "grok", installed: true }];
  terminal();
  const closed = vi.fn();
  const m = await open(closed, { page: "accounts" });
  const way = () => withText(m.container, "button", "Use an xAI API key")[0];
  await until(() => !!way(), "the Grok card");
  await click(m.container, way());
  const form = find(m.container, (n) => n.attrs["aria-label"] === "Use an xAI API key")[0];
  const shown = () => !("hidden" in form.parentNode!.attrs);
  await until(shown, "the key dialog");
  expect(doc.activeElement.attrs["aria-label"]).toBe("xAI API key");
  await press("Escape");
  expect(shown()).toBe(false);
  expect(closed).not.toHaveBeenCalled();
  // The browser takes the keyboard off a field that is no longer drawn; the next Escape leaves Settings.
  doc.activeElement = doc.body;
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});
