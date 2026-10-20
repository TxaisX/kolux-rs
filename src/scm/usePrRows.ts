// VIEW-043: the palette's pull request rows. While the palette is open, the open pull requests whose
// checks are unknown or old are read with the Checks panel's own command (scm_pr_checks), a few at
// a time, and each answer goes into the shared store the rows are built from.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PaletteItem } from "../projects/WorktreePalette";
import type { PrChecks } from "./checks";
import { getKnown, needChecks, prItems, recordChecks, subscribeKnown } from "./prSearch";

/** Checks read per opening of the palette, and how old they may be before they are read again. */
const MAX_READS = 6;
const STALE_MS = 60_000;

export function usePrRows(open: boolean, go: (path: string) => void): PaletteItem[] {
  const known = useSyncExternalStore(subscribeKnown, getKnown);
  useEffect(() => {
    if (!open) return;
    let dead = false;
    (async () => {
      for (const k of needChecks(getKnown(), Date.now(), STALE_MS, MAX_READS)) {
        if (dead) return;
        try {
          const data = await invoke<PrChecks>("scm_pr_checks", { worktree: k.path, linked: k.linked ? k.pr.url : null });
          if (!dead) recordChecks(k.path, data);
        } catch {
          // The row keeps saying "checks not read yet"; the Checks panel explains errors.
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [open]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (open ? prItems(known, go) : []), [open, known]);
}
