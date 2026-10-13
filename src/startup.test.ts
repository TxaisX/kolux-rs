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
