// T-286-b (APP-017): a hidden window does no interface work for live updates; they are held and
// replayed the moment it is shown, in order (or only the newest, for a stream where only the latest
// value matters). A long backlog replays in slices so it never freezes the window. After the
// computer wakes, the page redraws itself (recovery.rs emits "app-woke"). Listeners whose events
// raise desktop notifications are never held: those must fire while the window is hidden.
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

/** The page's cue from recovery.rs that the computer woke. */
export const WOKE_EVENT = "app-woke";
/** Updates applied per slice while replaying a backlog; the rest follow on the next frame. */
export const REPLAY_SLICE = 200;
/** The most updates one hold keeps; past it the oldest go (the newest state still arrives). */
export const HOLD_CAP = 5000;

/** The part of `document` a hold needs, so tests can stand in for it. */
export type Doc = {
  hidden: boolean;
  addEventListener(type: "visibilitychange", f: () => void): void;
  removeEventListener(type: "visibilitychange", f: () => void): void;
};

export type HoldOptions = {
  /** Keep only the newest update while hidden (a figure, a gauge); default keeps every one in order. */
  latestOnly?: boolean;
  cap?: number;
  doc?: Doc;
  /** Runs the next replay slice; the next animation frame by default. */
  later?: (f: () => void) => void;
};

const holds = new Set<Hold<unknown>>();

const nextFrame = (f: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => f()) : setTimeout(f, 16));

export class Hold<T> {
  private queue: T[] = [];
  private readonly doc: Doc | undefined;
  private readonly onVis = () => {
    if (!this.doc?.hidden) this.flush();
  };

  constructor(
    private readonly apply: (v: T) => void,
    private readonly opts: HoldOptions = {},
  ) {
    this.doc = opts.doc ?? (typeof document !== "undefined" ? document : undefined);
    this.doc?.addEventListener("visibilitychange", this.onVis);
    holds.add(this as Hold<unknown>);
  }

  /** Applies now when the window is shown; holds it while hidden. */
  push(v: T): void {
    if (!this.doc?.hidden && this.queue.length === 0) {
      this.apply(v);
      return;
    }
    if (this.opts.latestOnly) this.queue = [v];
    else {
      this.queue.push(v);
      const cap = this.opts.cap ?? HOLD_CAP;
      if (this.queue.length > cap) this.queue.splice(0, this.queue.length - cap);
    }
    if (!this.doc?.hidden) this.flush();
  }

  /** How many updates wait. */
  get held(): number {
    return this.queue.length;
  }

  /** Replays what was held, in order, a slice now and the rest on later frames. */
  flush(): void {
    const slice = this.queue.splice(0, REPLAY_SLICE);
    for (const v of slice) this.apply(v);
    if (this.queue.length > 0) (this.opts.later ?? nextFrame)(() => this.flush());
  }

  dispose(): void {
    this.doc?.removeEventListener("visibilitychange", this.onVis);
    holds.delete(this as Hold<unknown>);
    this.queue = [];
  }
}

/** Every hold replays now (after a wake, when the window may be shown without a visibility change). */
export function flushAll(): void {
  for (const h of holds) h.flush();
}

/** `listen` from Tauri, with the events held while the window is hidden and replayed when shown. */
export function heldListen<T>(event: string, handler: EventCallback<T>, opts: HoldOptions = {}): Promise<UnlistenFn> {
  const hold = new Hold<Parameters<EventCallback<T>>[0]>(handler, opts);
  return listen<T>(event, (e) => hold.push(e)).then(
    (off) => () => {
      off();
      hold.dispose();
    },
    (err) => {
      hold.dispose();
      throw err;
    },
  );
}

/** After a wake: everything held replays, and the page lays out and paints again from scratch. */
export function repaint(win: { dispatchEvent(e: Event): boolean } = window, root: { style: { transform: string } } | null = typeof document !== "undefined" ? document.documentElement : null, later: (f: () => void) => void = nextFrame): void {
  flushAll();
  win.dispatchEvent(new Event("resize"));
  if (!root) return;
  const before = root.style.transform;
  root.style.transform = "translateZ(0)";
  later(() => {
    root.style.transform = before;
  });
}
