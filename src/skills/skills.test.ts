// SKILL-017 / SKILL-018: what the Skills page shows from a scan, and the sidebar button.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import SkillsRow from "../projects/SkillsRow";
import { CHROME, chromeShown } from "../chrome/chromeItems";
import { NO_FILTERS, escapeCloses, filtersOn, rootState, shortPath, sourceCounts, viewOf, visible, type Root, type Scan, type Skill } from "./skills";

const sk = (name: string, source: Skill["source"], agents: Skill["agents"], extra: Partial<Skill> = {}): Skill => ({
  name,
  description: `${name} does things`,
  updated: 1_760_000_000_000,
  path: `C:\\Users\\me\\.x\\skills\\${name}\\SKILL.md`,
  source,
  agents,
  plugin: null,
  ...extra,
});
const root = (state: Root["state"], extra: Partial<Root> = {}): Root => ({ path: "C:\\r", label: "R", source: "home", agents: [], state, count: 0, note: null, ...extra });

const skills = [
  sk("release-notes", "home", ["claude"]),
  sk("tidy", "home", ["shared", "codex"]),
  sk("repo-rules", "workspace", ["claude"]),
  sk("pdf", "plugin", ["claude"], { plugin: "docs" }),
  sk("kolux-cli", "bundled", []),
];

test("SKILL-017: home and repo skills both show, with correct source counts", () => {
  expect(visible(skills, NO_FILTERS)).toHaveLength(5);
  expect(sourceCounts(skills, NO_FILTERS)).toEqual({ home: 2, workspace: 1, bundled: 1, plugin: 1 });
});

test("SKILL-017: Filter by Codex keeps only skills Codex can see; Clear filters brings them all back", () => {
  const codex = { ...NO_FILTERS, agent: "codex" as const };
  expect(visible(skills, codex).map((s) => s.name)).toEqual(["tidy"]);
  expect(sourceCounts(skills, codex)).toEqual({ home: 1, workspace: 0, bundled: 0, plugin: 0 });
  expect(filtersOn(codex)).toBe(true);
  expect(filtersOn(NO_FILTERS)).toBe(false);
  expect(visible(skills, NO_FILTERS)).toHaveLength(5);
  // The shared skills folder is a filter of its own.
  expect(visible(skills, { ...NO_FILTERS, agent: "shared" }).map((s) => s.name)).toEqual(["tidy"]);
});

test("SKILL-017: source chips and search narrow the list; every word has to match", () => {
  expect(visible(skills, { ...NO_FILTERS, sources: ["workspace", "plugin"] }).map((s) => s.name)).toEqual(["repo-rules", "pdf"]);
  expect(visible(skills, { ...NO_FILTERS, query: "REPO things" }).map((s) => s.name)).toEqual(["repo-rules"]);
  expect(visible(skills, { ...NO_FILTERS, query: "nothing-like-this" })).toHaveLength(0);
});

test("SKILL-017: scanning, failed, empty, no matches and list states", () => {
  const ok: Scan = { skills, roots: [root("scanned")] };
  expect(viewOf(null, null, true, 0)).toBe("scanning");
  expect(viewOf(null, "boom", false, 0)).toBe("failed");
  // A root that failed partway makes the page a failure with Retry, never a shorter list.
  expect(viewOf({ skills, roots: [root("scanned"), root("error", { note: "Took longer than 8 seconds" })] }, null, false, 5)).toBe("failed");
  expect(viewOf({ skills: [], roots: [root("not-found")] }, null, false, 0)).toBe("empty");
  expect(viewOf(ok, null, false, 0)).toBe("no-matches");
  expect(viewOf(ok, null, false, 5)).toBe("list");
});

test("SKILL-017: the folders popover names each root's state", () => {
  expect(rootState(root("scanned", { count: 1 }))).toBe("1 skill");
  expect(rootState(root("not-found"))).toBe("Not found");
  expect(rootState(root("not-scanned", { note: "WSL folders are not scanned yet" }))).toBe("Not scanned: WSL folders are not scanned yet");
  expect(rootState(root("error", { note: "denied" }))).toBe("Scan failed: denied");
  expect(rootState(root("partial", { count: 500, note: "Stopped after 500 skills" }))).toBe("500 skills, partly scanned: Stopped after 500 skills");
});

test("SKILL-017: long paths are shortened, short ones kept", () => {
  const long = "C:\\Users\\someone\\.codex\\plugins\\cache\\marketplace\\plugin-name\\0.6.12\\skills\\api-and-interface-design\\SKILL.md";
  const s = shortPath(long);
  expect(s.length).toBeLessThan(long.length);
  expect(s.startsWith("C:\\Users")).toBe(true);
  expect(s.endsWith("api-and-interface-design\\SKILL.md")).toBe(true);
  expect(shortPath("C:\\a\\SKILL.md")).toBe("C:\\a\\SKILL.md");
});

test("SKILL-017: Escape closes the page but never takes Escape from a focused input", () => {
  expect(escapeCloses({ tagName: "INPUT" } as unknown as EventTarget)).toBe(false);
  expect(escapeCloses({ tagName: "textarea" } as unknown as EventTarget)).toBe(false);
  expect(escapeCloses({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(false);
  expect(escapeCloses({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(true);
  expect(escapeCloses(null)).toBe(true);
});

test("SKILL-018: no Skills button on a fresh install; the button opens the page and shows as current", () => {
  expect(chromeShown({}, "skillsButton")).toBe(false);
  expect(CHROME.find((c) => c.id === "skillsButton")?.label).toBe("Show Skills button in the sidebar");
  const html = (open: boolean) => renderToString(createElement(SkillsRow, { open, onOpen: () => {}, onHide: () => {} }));
  expect(html(false)).toContain("Skills");
  expect(html(false)).not.toContain('aria-current="page"');
  expect(html(true)).toContain('aria-current="page"');
});
