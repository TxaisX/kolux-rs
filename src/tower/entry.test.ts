// FIX-4 (council d2 AFTER 8): the Tower's own window never evaluates the App module. main.tsx loads
// App with import() on the main window's branch only, so nothing in App's import graph runs in the
// Tower window. The counter below goes up each time the App module is evaluated.
import { afterEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ app: 0, drawn: [] as unknown[] }));

vi.mock("../App", () => {
  seen.app++;
  return { default: function App() { return null; } };
});
vi.mock("./TowerWindow", () => ({ default: function TowerWindow() { return null; } }));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: (el: unknown) => void seen.drawn.push(el) }) } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => (cmd === "get_settings" ? {} : null) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ show: async () => {} }) }));
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

afterEach(() => vi.unstubAllGlobals());

describe("FIX-4 the window entry point", () => {
  it("draws the Tower in the Tower window without evaluating the App module", async () => {
    await boot("#tower-window");
    expect(seen.app).toBe(0);
  });

  it("loads the App module in the main window", async () => {
    await boot("");
    expect(seen.app).toBe(1);
  });
});
