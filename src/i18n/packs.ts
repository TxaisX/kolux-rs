// SET-017 (T-210-c): the bundled language packs. Each pack is its own file under `packs/`, fetched only
// when its language is first needed (lookup.ts calls the loader then). Every pack is machine-translated
// (Txais approved machine translation, 2026-10-20) and says so in its `META`; a human review pass is
// in the after-list. Keep every key, placeholder and product name as in English.
import type { Language } from "../language";
import { registerPack, type Pack } from "./lookup";

export type PackMeta = {
  language: Exclude<Language, "en">;
  /** True for every bundled pack until a person has reviewed it. */
  machineTranslated: boolean;
  translatedOn: string;
  humanReviewed: boolean;
};

type PackModule = { META: PackMeta; default: Pack };

/** One loader per bundled language; English needs no pack. */
export const PACK_MODULES: Record<Exclude<Language, "en">, () => Promise<PackModule>> = {
  es: () => import("./packs/es"),
  fr: () => import("./packs/fr"),
  ja: () => import("./packs/ja"),
  "zh-CN": () => import("./packs/zh-CN"),
  ko: () => import("./packs/ko"),
};

/** Makes every bundled pack available to the text lookup (nothing is fetched until its language is in force). */
export function registerBundledPacks(): void {
  for (const [lang, load] of Object.entries(PACK_MODULES) as [Exclude<Language, "en">, () => Promise<PackModule>][]) {
    registerPack(lang, () => load().then((m) => m.default));
  }
}
