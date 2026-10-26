// SET-036 (after-list row 502): a settings field that saves "on leaving the field" lost what was typed when
// the user changed page or closed Settings without leaving the field first: the page unmounts the input,
// and a removed input fires no blur. `useLeaveSave(save)` runs the field's own save (always the latest
// one) when its page goes away and when the window closes. Every save given to it must be a no-op when
// nothing changed, because it can run right after a blur that already saved.
import { useEffect, useRef } from "react";

type Target = { addEventListener(type: string, f: () => void): void; removeEventListener(type: string, f: () => void): void };

/** Saves on window close (beforeunload, pagehide); the returned cleanup unhooks and saves once more (the page went away). */
export function bindLeave(win: Target, save: () => void): () => void {
  win.addEventListener("beforeunload", save);
  win.addEventListener("pagehide", save);
  return () => {
    win.removeEventListener("beforeunload", save);
    win.removeEventListener("pagehide", save);
    save();
  };
}

export function useLeaveSave(save: () => void): void {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => bindLeave(window, () => latest.current()), []);
}
