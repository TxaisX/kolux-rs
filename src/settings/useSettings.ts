import { useEffect, useState } from "react";
import { saveChanged } from "./saveChanged";
import { invoke } from "@tauri-apps/api/core";

/** Runs `fn` one call at a time, in call order; a failed call does not hold up the next. */
export function inTurn<A, R>(fn: (arg: A) => Promise<R>): (arg: A) => Promise<R> {
  let last: Promise<unknown> = Promise.resolve();
  return (arg) => {
    const run = last.catch(() => undefined).then(() => fn(arg));
    last = run;
    return run;
  };
}

/** Every page's saves share one turn: each reads, merges and writes what is on disk, so two at
 * once (a field's blur, then a switch) would drop the first. */
const saveInTurn = inTurn((patch: Record<string, unknown>) =>
  invoke<Record<string, unknown>>("get_settings").then((s) => {
    const next = { ...s, ...patch };
    return saveChanged(s, next).then(() => next);
  }),
);

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
    setSettings((s) => s && { ...s, ...patch });
    return saveInTurn(patch)
      .then(setSettings)
      .catch((e) => setError(String(e)));
  };
  return { settings, error, save };
}
