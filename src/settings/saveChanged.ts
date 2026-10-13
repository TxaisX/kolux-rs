import { invoke } from "@tauri-apps/api/core";

type Settings = Record<string, unknown>;

/** The keys `next` changed from `prev` (`set`) and the ones it dropped or cleared (`remove`). */
export function settingsDiff(prev: Settings, next: Settings): { set: Settings; remove: string[] } {
  const set: Settings = {};
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && JSON.stringify(prev[k]) !== JSON.stringify(v)) set[k] = v;
  }
  const remove = Object.keys(prev).filter((k) => prev[k] !== undefined && next[k] === undefined);
  return { set, remove };
}

/** Saves only the settings that differ between `prev` and `next`, laid over what is on disk, so a
 * setting Kolux wrote meanwhile (a pull request link printed in a terminal, GIT-026) is kept. */
export function saveChanged(prev: Settings, next: Settings): Promise<unknown> {
  return invoke("settings_patch", settingsDiff(prev, next));
}
