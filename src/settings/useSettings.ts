import { useEffect, useReducer, useRef, useState } from "react";
import type { ChangeEvent, CompositionEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Settings = Record<string, unknown>;
type Field = HTMLInputElement | HTMLTextAreaElement;

/** Runs `job` one call at a time, in the order asked; a failed call never holds up the next. */
export function inOrder<A, R>(job: (a: A) => Promise<R>): (a: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (a) => {
    const run = tail.then(() => job(a));
    tail = run.catch(() => {});
    return run;
  };
}

/** SET-035: lays `patch` over the stored settings (null removes a field) and settles with what was
 * really stored, secrets taken out. Saves apply in the order made, each on top of the last. */
export const patchSettings = inOrder((patch: Settings) => invoke<Settings>("patch_settings", { patch }));

/** The fields `next` changes from `prev`, as a patch: a field it drops is null (removed). */
export function changes(prev: Settings, next: Settings): Settings {
  const out: Settings = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!(k in next)) out[k] = null;
    else if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) out[k] = next[k];
  }
  return out;
}

/** The saved settings for a Settings page, and `save(patch)`, which settles `true` once it is
 * written or `false` when it failed (the error is shown and the page reads the stored value again). */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(0);
  useEffect(() => {
    const read = () =>
      invoke<Settings>("get_settings")
        // a change made while the settings were still loading wins over the load
        .then((s) => saving.current === 0 && setSettings(s))
        .catch((e) => setError(String(e)));
    void read();
    // every window takes the value that was really stored, whoever saved it
    const off = listen("settings-saved", () => void read());
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
  const save = (patch: Settings) => {
    setError(null);
    setSettings((s) => ({ ...(s ?? {}), ...patch }));
    saving.current += 1;
    return patchSettings(patch)
      .then((s) => (setSettings(s), true))
      .catch((e) => {
        setError(String(e));
        void invoke<Settings>("get_settings").then(setSettings, () => {});
        return false;
      })
      .finally(() => (saving.current -= 1));
  };
  return { settings, error, save };
}

export const DRAFT_PAUSE_MS = 600;

/** SET-036: what a text field holds between keystrokes and the save. */
export class Draft {
  private timer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private composing = false;
  constructor(
    public text: string,
    public commit: (text: string) => unknown,
    private base = text,
  ) {}
  /** The stored value arrived: shown unless there is typing not yet saved. Returns what to show. */
  stored(v: string): string {
    this.base = v;
    if (!this.dirty) this.text = v;
    return this.text;
  }
  type(t: string) {
    this.text = t;
    this.dirty = true;
    if (!this.composing) this.later();
  }
  /** Input-method composition: nothing is saved while it runs. */
  compose(on: boolean) {
    this.composing = on;
    clearTimeout(this.timer);
    if (!on && this.dirty) this.later();
  }
  private later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DRAFT_PAUSE_MS);
  }
  /** Saves now (leaving the field, changing page, closing the window). A failed save keeps the text. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.composing || !this.dirty) return;
    this.dirty = false;
    const t = this.text;
    if (t === this.base) return;
    let ok: unknown;
    try {
      ok = await this.commit(t);
    } catch {
      ok = false;
    }
    if (ok === false) this.dirty = true;
    else if (!this.dirty) this.base = t;
  }
}

const unsaved = new Set<() => unknown>();
/** Holds `save` until the window closes, unless the returned function lets it go first. */
export function saveOnClose(save: () => unknown): () => void {
  unsaved.add(save);
  return () => void unsaved.delete(save);
}
/** Saves every change not yet saved (SET-036: the window is closing). Never rejects. */
export const flushUnsaved = () => Promise.allSettled([...unsaved].map((save) => save()));

/** Props for a text or number `<input>` whose value saves itself (SET-036). */
export function useDraft(value: string, commit: (text: string) => unknown) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<Draft | null>(null);
  const d = (ref.current ??= new Draft(value, commit));
  d.commit = commit;
  useEffect(() => {
    const was = d.text;
    if (d.stored(value) !== was) redraw();
  }, [d, value]);
  useEffect(() => {
    const off = saveOnClose(() => d.flush());
    return () => {
      off();
      void d.flush();
    };
  }, [d]);
  return {
    value: d.text,
    onChange: (e: ChangeEvent<Field>) => (d.type(e.target.value), redraw()),
    onBlur: () => void d.flush(),
    onCompositionStart: () => d.compose(true),
    onCompositionEnd: (e: CompositionEvent<Field>) => (d.type(e.currentTarget.value), d.compose(false), redraw()),
  };
}

/** A clearable number field: empty (or not a number) is the default; otherwise rounded into range. */
export function numberOrDefault(text: string, dflt: number, [lo, hi]: readonly [number, number]): number {
  const n = Number(text.trim());
  return text.trim() === "" || !Number.isFinite(n) ? dflt : Math.min(hi, Math.max(lo, Math.round(n)));
}
