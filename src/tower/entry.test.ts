// FIX-4 (council d2 AFTER 8): the Tower's own window never evaluates the App module. main.tsx loads
// App with import() on the main window's branch only, so nothing in App's import graph runs in the
// Tower window. The counter below goes up each time the App module is evaluated.
import { afterEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ app: 0, drawn: [] as unknown[], failApp: false, shown: 0 }));

vi.mock("../App", () => {
  seen.app++;
  if (seen.failApp) throw new Error("Failed to fetch dynamically imported module");
  return { default: function App() { return null; } };
});
vi.mock("./TowerWindow", () => ({ default: function TowerWindow() { return null; } }));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: (el: unknown) => void seen.drawn.push(el) }) } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => (cmd === "get_settings" ? {} : null) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ show: async () => void seen.shown++ }) }));
vi.mock("../theme", () => ({ applyAppearance: () => {}, cachedAppearance: () => null, followSystemMode: () => {}, readAppearance: () => null }));
vi.mock("../settings/general", () => ({ stampLook: () => null }));
vi.mock("../settings/saveChanged", () => ({ saveChanged: async () => {} }));
vi.mock("../language", () => ({ applyLanguage: () => {}, LANGUAGE_FIELD: "language" }));
vi.mock("../settings/zoom", () => ({ applyZoom: () => {}, ZOOM_FIELD: "zoom" }));
vi.mock("../terminal/text", () => ({ followText: () => {} }));
vi.mock("../settings/menuWheel", () => ({ installMenuWheel: () => {} }));
vi.mock("../terminal/layout", () => ({ LAYOUT_FIELD: "layout", restoreAsks: () => false, restoreLayout: () => null, stillThere: (l: unknown) => l }));

async function boot(hash: string) {
  seen.app = 0;
  seen.drawn = [];
  vi.resetModules();
  vi.stubGlobal("location", { hash });
  vi.stubGlobal("document", { getElementById: () => ({}) });
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
  await import("../main");
  await vi.waitFor(() => expect(seen.drawn.length).toBe(1));
}

afterEach(() => {
  vi.unstubAllGlobals();
  seen.failApp = false;
});

describe("FIX-4 the window entry point", () => {
  it("draws the Tower in the Tower window without evaluating the App module", async () => {
    await boot("#tower-window");
    expect(seen.app).toBe(0);
  });

  // FIX-5 (council d2 AFTER 4): a chunk that fails to load must not leave the hidden window blank.
  it("shows a message and the window when the App module fails to load", async () => {
    seen.failApp = true;
    seen.shown = 0;
    seen.drawn = [];
    const root = { textContent: "", kids: [] as unknown[], append(...n: unknown[]) { this.kids.push(...n); } };
    vi.resetModules();
    vi.stubGlobal("location", { hash: "" });
    vi.stubGlobal("document", { getElementById: () => root, createElement: () => ({ setAttribute() {}, textContent: null }) });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
    await import("../main");
    await vi.waitFor(() => expect(seen.shown).toBe(1));
    expect(root.kids).toHaveLength(1);
    expect(seen.drawn).toHaveLength(0);
  });

  it("loads the App module in the main window", async () => {
    await boot("");
    expect(seen.app).toBe(1);
  });
});
