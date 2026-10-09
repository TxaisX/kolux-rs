// The routing page rendered to HTML with no browser: four tiers with a model picker each, and
// the effort picker only where the chosen model takes an effort.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import RoutingPage from "./RoutingPage";
import type { Provider } from "./routing";

const providers: Provider[] = [
  {
    id: "claude",
    name: "Claude Code",
    models: [
      { id: "sonnet", label: "Claude Sonnet", efforts: ["low", "medium", "high"] },
      { id: "haiku", label: "Claude Haiku", efforts: [] },
    ],
    defaults: [
      { model: "sonnet", effort: "high" },
      { model: "sonnet", effort: "high" },
      { model: "sonnet", effort: "medium" },
      { model: "haiku", effort: null },
    ],
  },
  { id: "codex", name: "Codex", models: [], defaults: [] },
];

test("four tiers, each with a model picker; a model with no effort levels has no effort picker", () => {
  const settings = { modelRouting: { claude: { deep: { model: "haiku", effort: "" } } } };
  const html = renderToString(createElement(RoutingPage, { settings, onSettings: () => {}, initial: providers }));
  for (const t of ["Major", "Deep", "Build", "Light"]) expect(html).toContain(`aria-label="${t} model"`);
  expect(html).toContain('aria-label="Major effort"');
  expect(html).toContain('aria-label="Build effort"');
  expect(html).not.toContain('aria-label="Deep effort"');
  expect(html).not.toContain('aria-label="Light effort"');
  expect(html).toContain("Provider default");
  expect(html).toContain("Codex");
});
