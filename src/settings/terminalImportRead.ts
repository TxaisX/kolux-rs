// TERM-099 / TERM-100 (T-307): the glue between the back end's folder reader (term_import.rs) and the
// importers in importSchemes.ts. The page (TerminalImport.tsx) shows what comes back before anything is saved.
import { invoke } from "@tauri-apps/api/core";
import type { CustomScheme } from "../terminal/schemes";
import { FIELD } from "../theme";
import { ghosttyThemeNames, importGhostty, planImport, scanWarp, type GhosttyFileIn, type GhosttyImport, type ImportPlan, type WarpFileIn, type WarpScan } from "./importSchemes";

/** The Ghostty configuration on this computer, mapped; null when there is none. */
export async function readGhostty(): Promise<GhosttyImport | null> {
  const files = await invoke<GhosttyFileIn[]>("term_import_ghostty");
  if (files.length === 0) return null;
  const themes = new Map<string, string | null>();
  for (const name of ghosttyThemeNames(files)) themes.set(name, await invoke<string | null>("term_import_ghostty_theme", { name }));
  return importGhostty(files, (n) => themes.get(n) ?? null);
}

/** The Warp themes in Warp's theme folders on this computer. */
export async function readWarp(): Promise<WarpScan> {
  return scanWarp(await invoke<WarpFileIn[]>("term_import_warp"));
}

/** What saving a Ghostty import writes: its settings, and its schemes joined to the saved ones (a name
 *  already there is replaced) with the dark one chosen for the terminal and the light one for light mode.
 *  A scheme that did not fit under the cap is not chosen. */
export function ghosttyPatch(saved: CustomScheme[], r: GhosttyImport): { patch: Record<string, unknown>; plan: ImportPlan } {
  const plan = planImport(saved, r.schemes);
  const patch: Record<string, unknown> = { ...r.settings };
  if (plan.added.length || plan.replaced.length) {
    patch[FIELD.custom] = plan.custom;
    const chosen = (n: string | null) => (n && !plan.refused.includes(n) ? "custom:" + n : null);
    const dark = chosen(r.darkScheme);
    const light = chosen(r.lightScheme);
    if (dark) patch[FIELD.terminal] = dark;
    if (light) patch[FIELD.lightScheme] = light;
  }
  return { patch, plan };
}

/** True when there is something in the import to save. */
export const hasChanges = (r: GhosttyImport) => Object.keys(r.settings).length > 0 || r.schemes.length > 0;
