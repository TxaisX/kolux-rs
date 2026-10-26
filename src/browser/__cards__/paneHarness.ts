// Shared harness for the BROW cards: the real BrowserPane on the small DOM, the back end stood in by a recorder.
import { createElement } from "react";
import { type FakeDocument, type FakeNode, find, installDom, mount, settle } from "../../tasks/fakeDom";

export const rec = {
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  handlers: new Map<string, (e: { payload: unknown }) => void>(),
};

/** The module stand-ins; each test file wires them with vi.mock(name, async () => (await import("./paneHarness")).<one>). */
export const coreMock = {
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    rec.calls.push({ cmd, args });
    return Promise.resolve(cmd === "browser_suggest" ? [] : null); // the real command answers a list
  },
};
export const eventMock = {
  listen: (name: string, fn: (e: { payload: unknown }) => void) => {
    rec.handlers.set(name, fn);
    return Promise.resolve(() => {});
  },
  emit: () => Promise.resolve(),
};
export const webviewMock = { getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) };
export const dialogMock = { open: () => Promise.resolve(null) };

export function installPaneDom() {
  const dom = installDom();
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, devicePixelRatio: 1 });
  const g = globalThis as unknown as Record<string, unknown>;
  g.getComputedStyle = () => ({ backgroundColor: "rgb(20, 20, 20)" });
  g.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  const proto = (dom.doc.createElement("div") as FakeNode).constructor.prototype as Record<string, unknown>;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
  proto.clientWidth = 400;
  proto.clientHeight = 300;
  rec.calls = [];
  rec.handlers.clear();
  return dom.doc as FakeDocument;
}

export async function mountPane(doc: FakeDocument, props: Record<string, unknown> = {}) {
  const { default: BrowserPane } = await import("../BrowserPane");
  const m = await mount(createElement(BrowserPane, { id: 7, ...props }), doc);
  await settle();
  return m;
}

export const sent = (cmd: string) => rec.calls.filter((c) => c.cmd === cmd);
export const button = (c: FakeNode, go: string) => find(c, (n) => n.localName === "button" && n.attrs["data-go"] === go)[0];

export const isDisabled = (n: FakeNode) => n.disabled === true || n.attrs.disabled !== undefined;
export const addressBar = (c: FakeNode) => find(c, (n) => n.localName === "input" && n.attrs["aria-label"] === "Address")[0];
export const notice = (c: FakeNode) => find(c, (n) => n.attrs.role === "alert").map((n) => n.textContent)[0] ?? null;
/** The back end hears a browser-load event the way the engine sends it. */
export async function engineLoad(event: "started" | "finished", url: string, id = 7) {
  const { act } = await import("react");
  await act(async () => {
    rec.handlers.get("browser-load")?.({ payload: { id, event, url } });
  });
}
export const last = <T>(a: T[]): T | undefined => a[a.length - 1];
