import { afterEach, expect, test } from "vitest";
import { applyLanguage } from "../language";
import { CONNECT, GLOSSARY } from "../glossary";
import { EN } from "./en";
import { loadPack, missing, onPackLoaded, packJargon, registerPack, t, type Pack } from "./lookup";

afterEach(() => void applyLanguage("en"));

test("T-210-b SET-017: with no pack for the language in force, every text reads in English", () => {
  for (const lang of ["ja", "zh-CN", "ko", "es", "fr"] as const) {
    applyLanguage(lang);
    expect(t("glossary.clone.plain")).toBe(EN["glossary.clone.plain"]);
    expect(CONNECT.claude).toBe(EN["connect.claude"]);
  }
  applyLanguage("system", ["zh-TW"]); // Traditional Chinese is English
  expect(GLOSSARY.worktree.plain).toBe("workspace");
});

test("T-210-b SET-017: a pack loads only when its language is needed, and any text it lacks shows in English", async () => {
  let loads = 0;
  const ja: Pack = { "glossary.worktree.plain": "ワークスペース" };
  registerPack("ja", async () => (loads++, ja));
  applyLanguage("fr");
  expect(t("glossary.worktree.plain")).toBe("workspace");
  expect(loads).toBe(0); // French in force: the Japanese pack is never fetched

  applyLanguage("ja");
  const seen: string[] = [];
  const off = onPackLoaded((l) => seen.push(l));
  expect(t("glossary.worktree.plain")).toBe("workspace"); // English stands in while the pack loads
  await loadPack("ja");
  await loadPack("ja");
  off();
  expect(loads).toBe(1);
  expect(seen).toEqual(["ja"]);
  expect(t("glossary.worktree.plain")).toBe("ワークスペース");
  expect(GLOSSARY.worktree.plain).toBe("ワークスペース"); // the glossary reads through the lookup
  expect(t("glossary.clone.plain")).toBe("Copy from a web address"); // lacked by the pack
  expect(missing("ja")).not.toContain("glossary.worktree.plain");
  expect(missing("ja")).toContain("connect.codex");
  applyLanguage("en");
  expect(t("glossary.worktree.plain")).toBe("workspace");
});

test("T-210-b SET-017: a pack that fails to load leaves English showing", async () => {
  registerPack("ko", () => Promise.reject(new Error("pack file missing")));
  applyLanguage("ko");
  await expect(loadPack("ko")).resolves.toEqual({});
  expect(t("connect.codex")).toBe(EN["connect.codex"]);
});

test("T-210-b SET-017: product and provider names pass through as values, untranslated", () => {
  registerPack("es", async () => ({}));
  expect(t("connect.claude", { unused: "x" })).toBe(EN["connect.claude"]);
  // a placeholder with no value is left visible rather than dropped
  expect(t("glossary.cli.plain", {})).toBe("program");
});

test("T-210-b ONB-036: the plain-words guard holds in every language", async () => {
  expect(packJargon(EN)).toEqual([]); // English on-screen texts are plain; hover texts may name the term
  expect(packJargon({ "glossary.worktree.plain": "worktree", "glossary.worktree.hover": "a Git worktree" })).toEqual(['glossary.worktree.plain: "worktree"']);
  // an untranslated technical word left inside a pack's on-screen text is caught
  registerPack("fr", async () => ({ "glossary.repository.plain": "le repo" }));
  const fr = await loadPack("fr");
  expect(packJargon(fr)).toEqual(['glossary.repository.plain: "repo"']);
});
