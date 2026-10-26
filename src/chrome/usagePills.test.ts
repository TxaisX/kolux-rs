import { expect, test } from "vitest";
import { STATUS_ITEMS, usagePills } from "./statusItems";

const both = { claudeInstalled: true, claudeWeekly: true, codexInstalled: true, codexAccount: true, codexFigure: true };

test("USAGE-008 / USAGE-029: the status-bar item list has a usage item per provider in the top pill", () => {
  const ids: string[] = STATUS_ITEMS.map((i) => i.id);
  expect(ids).toContain("pill-claude");
  expect(ids).toContain("pill-codex");
});

test("USAGE-008: with nothing switched off, both providers show in the pill", () => {
  expect(usagePills({ ...both, hidden: [] })).toEqual({ claude: true, codex: true, any: true });
});

test("USAGE-008: turning Codex off hides the Codex part and leaves Claude's", () => {
  expect(usagePills({ ...both, hidden: ["pill-codex"] })).toEqual({ claude: true, codex: false, any: true });
});

test("USAGE-008: turning Claude off hides the Claude part and leaves Codex's", () => {
  expect(usagePills({ ...both, hidden: ["pill-claude"] })).toEqual({ claude: false, codex: true, any: true });
});

test("USAGE-029: turning both off shows no usage pill at all", () => {
  expect(usagePills({ ...both, hidden: ["pill-claude", "pill-codex"] })).toEqual({ claude: false, codex: false, any: false });
});

test("USAGE-008: a provider still needs its CLI, its account and a figure; other items do not matter", () => {
  expect(usagePills({ ...both, claudeInstalled: false, hidden: ["memory"] }).claude).toBe(false);
  expect(usagePills({ ...both, claudeWeekly: false, hidden: [] }).any).toBe(true);
  expect(usagePills({ ...both, codexAccount: false, hidden: [] }).codex).toBe(false);
  expect(usagePills({ ...both, codexFigure: false, claudeWeekly: false, hidden: [] }).any).toBe(false);
});
