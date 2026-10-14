// ONB-042: Kolux remembers on this machine which features each profile has used. onboarding.rs
// keeps the record (first use, running count, a fixed list of about forty features); this side
// sends uses once the saved record has loaded, and answers has-used checks.
import { invoke } from "@tauri-apps/api/core";

export type Use = { first: number; count: number };
export type Features = Record<string, Use>;

/** The uses noted before the record loaded are not counted (ONB-042). */
export function featureMemory(send: (id: string) => Promise<unknown> = (id) => invoke("guide_mark", { list: "used", id })) {
  let loaded = false;
  let known: Features = {};
  return {
    /** Called once the saved record has been read; uses noted before this are dropped. */
    loaded(f: Features | undefined) {
      loaded = true;
      known = { ...(f ?? {}) };
    },
    /** A use of `id`: sent to the record (which counts it) once the record has loaded. */
    note(id: string, now = Date.now()) {
      if (!loaded) return false;
      const was = known[id];
      known = { ...known, [id]: { first: was?.first ?? now, count: (was?.count ?? 0) + 1 } };
      void send(id).catch(() => {});
      return true;
    },
    used: (id: string) => (known[id]?.count ?? 0) > 0,
  };
}

/** The one memory the window shares. */
export const features = featureMemory();
export const noteUse = (id: string) => features.note(id);
export const hasUsed = (id: string) => features.used(id);
