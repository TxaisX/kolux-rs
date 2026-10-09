// The keymap the window runs on. The provider reads `~/.kolux/keybindings.json` through the
// Rust side once at start (reload is explicit, COMPAT.md 4.1: no file watcher), resolves it with
// the built-in defaults and hands the map to every component that shows or presses a shortcut.
// Without a provider (tests, server rendering) the context holds this platform's defaults.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultsOnly, detectPlatform, labelOf, resolve, type Keymap } from "./keymap";

export type KeybindingsFile = { path: string; value: unknown; created: boolean; error: string | null };

export type KeymapState = Keymap & {
  /** Where the file lives, once the Rust side has said. */
  path: string | null;
  /** Reads the file again. */
  reload: () => void;
};

const platform = detectPlatform();
const fallback: KeymapState = { ...defaultsOnly(platform), path: null, reload: () => {} };

export const KeymapContext = createContext<KeymapState>(fallback);

export function KeymapProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<KeybindingsFile | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reload = useCallback(() => {
    invoke<KeybindingsFile>("keybindings_read")
      .then((f) => {
        setFile(f);
        setFailure(null);
      })
      .catch((e) => setFailure(String(e)));
  }, []);
  useEffect(reload, [reload]);
  const value = useMemo<KeymapState>(() => {
    const map = resolve(file?.value ?? null, platform);
    const errors = [...(file?.error ? [file.error] : []), ...(failure ? [`Could not read the shortcuts file: ${failure}`] : []), ...map.errors];
    return { ...map, errors, path: file?.path ?? null, reload };
  }, [file, failure, reload]);
  return <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>;
}

export const useKeymap = () => useContext(KeymapContext);

/** The parts of an action's first chord as the user reads them, [] when unassigned. */
export function useLabel(id: string): string[] {
  return labelOf(useKeymap(), id);
}

/** A chord drawn as keycaps with "+" between them, or "Unassigned". */
export function Kbd({ id }: { id: string }) {
  const parts = useLabel(id);
  if (parts.length === 0) return <span className="kbd-none">Unassigned</span>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="kbd-part">
          {i > 0 && <span className="kbd-plus">+</span>}
          <span className="kbd">{p}</span>
        </span>
      ))}
    </>
  );
}

/** A chord as plain text, "Ctrl+J", or "Unassigned". */
export function KeyText({ id }: { id: string }) {
  const parts = useLabel(id);
  return <>{parts.length ? parts.join("+") : "Unassigned"}</>;
}
