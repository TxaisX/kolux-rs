import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CARD_DENSITY_FIELD, CARD_DETAILS_FIELD, cardLine, cardShows, cardTitle, densityPatch, detailPatch, hoverLines, readCardDetails, tidyDetails, type CardFacts } from "./cards";
import CardLine from "./CardLine";

const facts = (o: Partial<CardFacts> = {}): CardFacts => ({ agents: 0, state: "idle", pr: null, changed: 0, note: null, ...o });

test("PROJ-062: nothing saved is the Default preset: status and the agent summary", () => {
  expect(readCardDetails({})).toEqual({ shown: ["status", "agents"], density: "default" });
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "nonsense" }).density).toBe("default");
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "compact" })).toEqual({ shown: ["status"], density: "compact" });
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "detailed" }).shown).toEqual(["status", "agents", "pr", "changes", "note"]);
});

test("PROJ-062: status stays on in both presets and in any custom set; older profiles get no duplicates or unknown ids", () => {
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "compact" }).shown).toContain("status");
  const odd = readCardDetails({ [CARD_DETAILS_FIELD]: ["pr", "pr", "note", "ports-of-call", 7, "agents", "agents"] });
  expect(odd.shown).toEqual(["status", "agents", "pr", "note"]);
  expect(odd.density).toBe("custom");
  expect(tidyDetails(["pr"])).toEqual(["status", "pr"]);
  expect(tidyDetails("nope")).toEqual(["status"]);
});

test("PROJ-062: an empty custom list follows the preset, so a preset keeps up with later details", () => {
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "detailed", [CARD_DETAILS_FIELD]: [] }).density).toBe("detailed");
  expect(cardShows({ [CARD_DENSITY_FIELD]: "compact" }, "agents")).toBe(false);
  expect(cardShows({}, "agents")).toBe(true);
});

test("SET-021: picking a preset saves it and clears any custom list; a ticked set equal to a preset is saved as that preset", () => {
  expect(densityPatch("compact")).toEqual({ workspaceCardDensity: "compact", workspaceCardDetails: [] });
  expect(detailPatch({}, "pr", true)).toEqual({ workspaceCardDetails: ["status", "agents", "pr"] });
  expect(detailPatch({}, "agents", false), "Default minus the summary is Compact").toEqual(densityPatch("compact"));
  const s = { ...detailPatch({}, "pr", true) };
  expect(detailPatch(s, "pr", false), "back to Default").toEqual(densityPatch("default"));
  expect(detailPatch({}, "status", false), "status cannot be switched off").toEqual({});
  expect(detailPatch({}, "mystery", true)).toEqual({});
});

test("PROJ-062: the card's second line says agents, state, pull request, changes and note, and only for what is shown", () => {
  const f = facts({ agents: 2, state: "permission", pr: "open", changed: 3, note: "  first line\nsecond" });
  expect(cardLine(["status", "agents"], f)).toBe("2 agents · Needs you");
  expect(cardLine(["status"], f), "Compact draws no second line").toBeNull();
  expect(cardLine(readCardDetails({ workspaceCardDensity: "detailed" }).shown, f)).toBe("2 agents · Needs you · Pull request open · 3 changed files · first line");
  expect(cardLine(["status", "agents"], facts()), "an idle workspace with no agent says nothing").toBeNull();
  expect(cardLine(["status", "agents"], facts({ agents: 1, state: "working" }))).toBe("1 agent · Working");
  expect(cardLine(["status", "changes"], facts({ changed: 1 }))).toBe("1 changed file");
  expect(cardLine(["status", "note"], facts({ note: "x".repeat(80) }))?.length).toBe(60);
});

test("PROJ-062: Compact hover lists the pull request and the rest, and a long title shows even when the branch is shown", () => {
  const f = facts({ pr: "draft", changed: 2, agents: 1, state: "working" });
  expect(hoverLines(["status"], f)).toEqual(["1 agent · Working", "Draft pull request", "2 changed files"]);
  const t = cardTitle("a very long workspace title", "feature/x", ["status"], f, "Show C:\\w\\x");
  expect(t.split("\n")).toEqual(["a very long workspace title", "Branch feature/x", "1 agent · Working", "Draft pull request", "2 changed files", "Show C:\\w\\x"]);
  expect(cardTitle("same", "same", ["status", "agents", "pr", "changes", "note"], f, "Show p")).toBe("same\nShow p");
});

test("PROJ-062: CardLine draws the line indented under the name, or nothing", () => {
  const html = renderToString(createElement(CardLine, { shown: ["status", "agents"], facts: facts({ agents: 1, state: "working" }), indent: 58 }));
  expect(html).toContain("1 agent · Working");
  expect(html).toContain("padding-left:58px");
  expect(renderToString(createElement(CardLine, { shown: ["status"], facts: facts({ agents: 1, state: "working" }), indent: 44 }))).toBe("");
});
