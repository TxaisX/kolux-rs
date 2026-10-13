import { afterEach, expect, test } from "vitest";
import { applyLanguage, LANGUAGES, locale, savedLanguage, systemLanguage } from "./language";
import { ago, naturalCompare } from "./automations/model";
import { resetWords } from "./usage/codex";
import { signedInAt } from "./settings/AccountRow";

afterEach(() => void applyLanguage("en"));

test("SET-017: System follows the OS when it is one of the six, Traditional Chinese and the rest fall back to English", () => {
  expect(systemLanguage(["zh-TW"])).toBe("en");
  expect(systemLanguage(["zh-Hant-HK"])).toBe("en");
  expect(systemLanguage(["zh-CN"])).toBe("zh-CN");
  expect(systemLanguage(["zh-Hans-SG"])).toBe("zh-CN");
  expect(systemLanguage(["ja-JP", "en-US"])).toBe("ja");
  expect(systemLanguage(["fr-CA"])).toBe("fr");
  expect(systemLanguage(["de-DE", "fr-FR"])).toBe("en");
  expect(systemLanguage([])).toBe("en");
  expect(applyLanguage("system", ["zh-TW"])).toBe("en");
  expect(applyLanguage(undefined, ["ko-KR"])).toBe("ko");
});

test("SET-017: an unknown saved value means System; the seven choices are named in their own languages", () => {
  expect(savedLanguage("klingon")).toBe("system");
  expect(savedLanguage(7)).toBe("system");
  expect(savedLanguage("ja")).toBe("ja");
  expect(applyLanguage("klingon", ["es-MX"])).toBe("es");
  expect(LANGUAGES.map((l) => l.id)).toEqual(["system", "en", "zh-CN", "ko", "ja", "es", "fr"]);
  expect(LANGUAGES.map((l) => l.name)).toContain("Français");
});

test("SET-017: picking Japanese turns relative times, weekdays and dates Japanese; English keeps its words", () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);
  expect(ago(now - 3 * 3600_000, now)).toBe("3 h ago");
  applyLanguage("ja");
  expect(locale()).toBe("ja");
  expect(ago(now - 3 * 3600_000, now)).toBe("3 時間前");
  expect(ago(now - 5 * 60_000, now)).toBe("5 分前");
  expect(resetWords((now + 3 * 86400_000) / 1000, new Date(now))).toMatch(/[日月火水木金土]/);
  expect(signedInAt(now).startsWith("2026/10/1")).toBe(true);
});

test("SET-017: sorted lists use the language's own order (Spanish puts ñ after n)", () => {
  expect(naturalCompare("ñu", "nz")).toBeLessThan(0);
  applyLanguage("es");
  expect(naturalCompare("ñu", "nz")).toBeGreaterThan(0);
  expect(naturalCompare("Run 2", "Run 10")).toBeLessThan(0);
});
