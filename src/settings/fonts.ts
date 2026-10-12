// SET-018: font pickers for the interface and the editor. The installed families are asked for once,
// the first time a picker opens; if that fails the built-in list below stands in.
import { invoke } from "@tauri-apps/api/core";

/** Common Windows, macOS and Linux families, offered when the system list cannot be read. */
export const FALLBACK_FONTS = ["Arial", "Calibri", "Cascadia Code", "Cascadia Mono", "Consolas", "Courier New", "DejaVu Sans", "DejaVu Sans Mono", "Georgia", "Helvetica", "Inter", "JetBrains Mono", "Lucida Console", "Menlo", "Monaco", "Noto Sans", "Roboto", "SF Mono", "Segoe UI", "Segoe UI Variable", "Tahoma", "Times New Roman", "Ubuntu", "Verdana"];

/** Names that start with the text first, then names that merely contain it; list order within each. */
export function rankFonts(list: string[], text: string): string[] {
  const q = text.trim().toLowerCase();
  if (!q) return list;
  const starts = list.filter((f) => f.toLowerCase().startsWith(q));
  return [...starts, ...list.filter((f) => !starts.includes(f) && f.toLowerCase().includes(q))];
}

/** The family quoted, with characters that could break out of a CSS value removed, then `fallback`
 *  so text is still drawn when the family is not installed. Empty means just `fallback`. */
export function fontStack(family: string, fallback: string): string {
  const clean = family.replace(/["'\;{}<>]/g, "").trim();
  return clean ? `"${clean}", ${fallback}` : fallback;
}

let fonts: Promise<string[]> | null = null;
/** The installed families (asked once per run), or the built-in list when they cannot be read. */
export function loadFonts(): Promise<string[]> {
  fonts ??= invoke<string[]>("list_fonts").catch(() => FALLBACK_FONTS);
  return fonts;
}
