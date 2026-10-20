import { afterEach, expect, test } from "vitest";
import { applyLanguage, LANGUAGES } from "../language";
import { GLOSSARY } from "../glossary";
import { EN, type TextKey } from "./en";
import { loadPack, missing, packJargon, t } from "./lookup";
import { PACK_MODULES, registerBundledPacks } from "./packs";

afterEach(() => void applyLanguage("en"));

const keys = Object.keys(EN) as TextKey[];
const langs = Object.keys(PACK_MODULES) as (keyof typeof PACK_MODULES)[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const markup = (s: string) => [...s.matchAll(/<\/?[a-z][^>]*>/gi)].map((m) => m[0]).sort();
const NAMES = ["Kolux", "Claude", "Codex", "ChatGPT", "Git", "PTY", "CLI"];

test("T-210-c SET-017: the bundled packs cover exactly the languages the Interface list offers besides System and English", () => {
  const offered = LANGUAGES.map((l) => l.id).filter((id) => id !== "system" && id !== "en");
  expect([...langs].sort()).toEqual([...offered].sort());
});

for (const lang of langs) {
  test(`T-210-c SET-017: the ${lang} pack has English's key set, placeholders, markup and names, and no empty text`, async () => {
    const mod = await PACK_MODULES[lang]();
    const pack = mod.default as Record<string, string>;
    expect(Object.keys(pack).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      const v = pack[k];
      expect(typeof v, k).toBe("string");
      expect(v.trim().length, `${lang} ${k} is empty`).toBeGreaterThan(0);
      expect(placeholders(v), `${lang} ${k} placeholders`).toEqual(placeholders(EN[k]));
      expect(markup(v), `${lang} ${k} markup`).toEqual(markup(EN[k]));
      // product names and the PTY and CLI terms English keeps by name stay exactly as written
      for (const n of NAMES) if (new RegExp(`\\b${n}\\b`).test(EN[k])) expect(v, `${lang} ${k} keeps ${n}`).toContain(n);
    }
    expect(mod.META).toMatchObject({ language: lang, machineTranslated: true, humanReviewed: false });
    expect(mod.META.translatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test(`T-210-c ONB-036: the ${lang} pack's on-screen texts pass the plain-words guard`, async () => {
    expect(packJargon((await PACK_MODULES[lang]()).default)).toEqual([]);
  });
}

test("T-210-c SET-017: with the bundled packs registered, a language in force reads in that language and the rest stay English", async () => {
  registerBundledPacks();
  applyLanguage("ja");
  expect(t("glossary.worktree.plain")).toBe(EN["glossary.worktree.plain"]); // English stands in while the pack loads
  await loadPack("ja");
  expect(t("glossary.worktree.plain")).toBe("ワークスペース");
  expect(GLOSSARY.worktree.plain).toBe("ワークスペース");
  expect(missing("ja")).toEqual([]);
  expect(t("connect.claude")).toContain("Claude");
  applyLanguage("fr");
  await loadPack("fr");
  expect(GLOSSARY.repository.plain).toBe("projet");
  applyLanguage("system", ["zh-TW"]); // Traditional Chinese reads English
  expect(t("glossary.worktree.plain")).toBe(EN["glossary.worktree.plain"]);
  applyLanguage("en");
  expect(GLOSSARY.worktree.plain).toBe("workspace");
});
