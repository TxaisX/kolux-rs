import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** The saved settings for a Settings page, and `save(patch)`, which merges into what is on disk
 * and settles once it is written. */
export function useSettings() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<Record<string, unknown>>("get_settings")
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, []);
  const save = (patch: Record<string, unknown>) => {
    setError(null);
    return invoke<Record<string, unknown>>("get_settings")
      .then((s) => {
        const next = { ...s, ...patch };
        setSettings(next);
        return invoke("save_settings", { value: next });
      })
      .catch((e) => setError(String(e)));
  };
  return { settings, error, save };
}
