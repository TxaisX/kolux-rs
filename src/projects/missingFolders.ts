// PROJ-086: a workspace whose folder was deleted by hand is flagged on its row.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** The paths whose folder is gone; a lookup that fails flags nothing (it is not evidence of a missing folder). */
export async function findMissing(paths: string[], kindOf: (path: string) => Promise<string>): Promise<Set<string>> {
  const kinds = await Promise.all(paths.map((p) => kindOf(p).catch(() => "dir")));
  return new Set(paths.filter((_, i) => kinds[i] === "missing"));
}

const kindOnDisk = (path: string) => invoke<string>("path_kind", { path, folderOnly: true });

/** Re-checks when the list changes and when the window comes back into focus. */
export function useMissingFolders(paths: string[]): ReadonlySet<string> {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const key = paths.join("\n");
  useEffect(() => {
    let live = true;
    const check = () => void findMissing(key === "" ? [] : key.split("\n"), kindOnDisk).then((s) => live && setGone(s));
    check();
    window.addEventListener("focus", check);
    return () => {
      live = false;
      window.removeEventListener("focus", check);
    };
  }, [key]);
  return gone;
}
