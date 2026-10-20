// SET-036 (T-181): a settings text field that never loses what was typed. The controller holds the
// text the user is typing apart from the saved value: it saves after a short pause, straight away on
// leaving, keeps keystrokes made while a save runs, saves in order, keeps the text when a save fails,
// never saves input-method composition half-way, and ignores an update from outside while the user
// has unsaved text (the draft survives).

export const DRAFT_PAUSE_MS = 600;

export type DraftState = { text: string; saved: string; dirty: boolean; saving: boolean; composing: boolean; error: string | null };

type Timer = { set(fn: () => void, ms: number): unknown; clear(t: unknown): void };
const realTimer: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export type DraftOptions = {
  /** Stores `text`; rejects when the save fails. */
  save: (text: string) => Promise<unknown>;
  pause?: number;
  timer?: Timer;
};

export function createDraft(initial: string, opts: DraftOptions) {
  const pause = opts.pause ?? DRAFT_PAUSE_MS;
  const timer = opts.timer ?? realTimer;
  let s: DraftState = { text: initial, saved: initial, dirty: false, saving: false, composing: false, error: null };
  let wait: unknown = null;
  let running: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DraftState>) => {
    s = { ...s, ...patch };
    s.dirty = s.text !== s.saved;
    listeners.forEach((l) => l());
  };
  const stop = () => {
    if (wait !== null) timer.clear(wait);
    wait = null;
  };
  const arm = () => {
    stop();
    if (s.composing || !s.dirty) return;
    wait = timer.set(() => {
      wait = null;
      void flush();
    }, pause);
  };
  /** Saves until the stored text is the typed text. One save at a time; a keystroke made meanwhile
   * is picked up by the next round, each on top of the last stored result. */
  const loop = async () => {
    for (;;) {
      if (!s.dirty || s.composing) return;
      const sent = s.text;
      set({ saving: true });
      try {
        await opts.save(sent);
      } catch (e) {
        set({ saving: false, error: e instanceof Error ? e.message : String(e) }); // the typed text stays for another try
        return;
      }
      set({ saved: sent, saving: false, error: null });
    }
  };
  function flush(): Promise<void> {
    stop();
    if (!running) {
      running = loop().finally(() => {
        running = null;
      });
    }
    return running;
  }
  return {
    state: () => s,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** A keystroke or paste. */
    type(text: string) {
      set({ text });
      arm();
    },
    compositionStart() {
      stop();
      set({ composing: true });
    },
    /** The composition finished with `text` in the field. */
    compositionEnd(text: string) {
      set({ composing: false, text });
      arm();
    },
    /** Leaving the field, changing page or closing the window: save now. The browser ends any
     * composition when the field loses focus, so what is on screen is final. */
    leave(): Promise<void> {
      if (s.composing) set({ composing: false });
      return flush();
    },
    flush,
    /** The stored value changed from outside (another window, an import). A draft with unsaved text
     * or a save in progress is kept; otherwise the field takes the new value. */
    outside(value: string) {
      if (s.dirty || s.saving || s.composing) return false;
      set({ text: value, saved: value, error: null });
      return true;
    },
    /** Puts the field back to the stored text (Escape). */
    discard() {
      stop();
      set({ text: s.saved, composing: false, error: null });
    },
    dispose() {
      stop();
    },
  };
}
export type Draft = ReturnType<typeof createDraft>;
