import { describe, expect, it } from "vitest";
import app from "./App.tsx?raw";

// APP-002: optional overlays are not loaded at startup; each loads the first time it opens.

describe("the first window loads only what it shows (APP-002)", () => {
  for (const page of ["settings/SettingsPage", "automations/AutomationsPage", "settings/RoutingPage", "artifacts/ArtifactsPage"]) {
    it(`${page} loads when first opened, not at startup`, () => {
      expect(app).not.toMatch(new RegExp(`^import [^;]*from "\./${page}";`, "m"));
      expect(app).toContain(`lazy(() => import("./${page}"))`);
    });
  }
});

// VIEW-107 + APP-006 (council review of a08f2bb, B1): Tauri destroys the window after every close
// listener that does not call preventDefault, so a second listener closes the window before the
// unsaved/busy question can show. There is exactly one, and it writes the shown screen first.
describe("closing the window asks before anything is lost (APP-006, VIEW-107)", () => {
  it("has exactly one close listener", () => {
    expect(app.match(/onCloseRequested\(/g)?.length).toBe(1);
  });
  it("the close listener writes the shown screen before it waits on anything", () => {
    const at = app.indexOf("onCloseRequested(");
    const body = app.slice(at, at + 600);
    expect(body.indexOf("screenWriter.flush()")).toBeGreaterThan(0);
    expect(body.indexOf("screenWriter.flush()")).toBeLessThan(body.indexOf("await "));
    expect(body).toContain("quitQuestion(busy, unsavedTabs())");
  });
});
