// Native chat, the window side of reading a transcript (CHAT-009; T-330). A chat that is hidden
// (its screen left, its window minimised) reads nothing and holds no retry timer; shown again it
// starts one new read whose first snapshot replaces whatever was stale. What was last read is kept
// per pane, for as long as the terminal behind the pane is the same one, so coming back shows the
// conversation at once, and a read that fails afterwards leaves it in place: a full-pane error
// appears only when nothing was kept.
import { applyRead, type ChatItem, type ChatRead } from "./model";

/** What the chat shows of its transcript: the conversation, what the reading says of it, and the error if any. */
export type Seen = { items: ChatItem[]; state: ChatRead["state"]; error: string | null; open: boolean };

/** Nothing read yet. */
export const NOTHING: Seen = { items: [], state: "loading", error: null, open: false };

/** How long to wait before looking again after a failed call. */
export const FAILED_RETRY_MS = 10_000;

/** The last good view of each pane and the terminal session it was read from. */
const kept = new Map<number, { session: number | undefined; seen: Seen }>();
/** More panes than this are never open at once; the oldest view goes first. */
const KEPT_PANES = 32;

/** The pane's kept view, only if it was read from the same terminal session; otherwise it is thrown away. */
export function keptFor(pane: number, session: number | undefined): Seen | null {
  const k = kept.get(pane);
  if (!k) return null;
  if (k.session === session) return k.seen;
  kept.delete(pane);
  return null;
}

/** Remembers a view worth coming back to (one with messages in it). */
export function keepSeen(pane: number, session: number | undefined, seen: Seen) {
  if (seen.items.length === 0) return;
  kept.delete(pane);
  kept.set(pane, { session, seen });
  while (kept.size > KEPT_PANES) kept.delete(kept.keys().next().value as number);
}

export const forgetKept = (pane: number) => void kept.delete(pane);
export const forgetAllKept = () => kept.clear();

/** Folds one look into what is shown. `got`: the transcript's answer, or the reason the call failed.
 * `first`: this is the first look since the chat was shown, whose snapshot replaces whatever was
 * stale. A loading or error answer never takes a conversation off the screen. */
export function takeRead(prev: Seen, got: ChatRead | { failed: string }, first: boolean): Seen {
  const keptSome = prev.items.length > 0;
  if ("failed" in got) return keptSome ? prev : { ...NOTHING, state: "error", error: got.failed };
  if (got.state === "loading" || got.state === "error") {
    if (keptSome) return prev;
    return { items: [], state: got.state, error: got.error ?? null, open: false };
  }
  const items = first || got.reset ? got.items : applyRead(prev.items, got);
  return { items, state: got.state, error: null, open: got.open };
}

export type Timers = { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };

export type ReaderOptions = {
  pane: number;
  /** The terminal session behind the pane; kept messages from another one are thrown away. */
  session: number | undefined;
  /** True when the chat begins hidden: it reads nothing until `show`. */
  hidden: boolean;
  read: () => Promise<ChatRead>;
  /** Lets go of the transcript, so the next read starts from the top. */
  close: () => void;
  onChange: (seen: Seen) => void;
  timers?: Timers;
};

/** Reads one pane's transcript while shown. */
export class ChatReader {
  seen: Seen;
  private on = false;
  private first = true;
  private turn = 0;
  private timer: unknown = undefined;
  private timers: Timers;

  constructor(private o: ReaderOptions) {
    this.timers = o.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };
    this.seen = keptFor(o.pane, o.session) ?? NOTHING;
    if (!o.hidden) this.show();
  }

  /** Starts reading: one new read, whose first snapshot replaces what is shown. */
  show() {
    if (this.on) return;
    this.on = true;
    this.first = true;
    this.look();
  }

  /** Stops reading, cancels the pending retry, ignores a read still out, and lets go of the transcript. */
  hide() {
    if (!this.on) return;
    this.on = false;
    this.turn++;
    this.stopTimer();
    keepSeen(this.o.pane, this.o.session, this.seen);
    this.o.close();
  }

  private stopTimer() {
    if (this.timer !== undefined) this.timers.clear(this.timer);
    this.timer = undefined;
  }

  private look() {
    const mine = ++this.turn;
    const again = (ms: number) => {
      this.timer = this.timers.set(() => {
        this.timer = undefined;
        if (this.on && mine === this.turn) this.look();
      }, ms);
    };
    const take = (got: ChatRead | { failed: string }) => {
      if (!this.on || mine !== this.turn) return;
      const good = !("failed" in got) && (got.state === "ready" || got.state === "empty");
      this.seen = takeRead(this.seen, got, this.first);
      if (good) this.first = false;
      keepSeen(this.o.pane, this.o.session, this.seen);
      this.o.onChange(this.seen);
      again("failed" in got ? FAILED_RETRY_MS : got.retryMs);
    };
    this.o.read().then(take, (e) => take({ failed: String(e) }));
  }
}

/** Calls `change` with whether the window's page is hidden (minimised, or another window on top of a hidden tab). */
export function watchHidden(doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">, change: (hidden: boolean) => void): () => void {
  const on = () => change(doc.visibilityState === "hidden");
  doc.addEventListener("visibilitychange", on);
  return () => doc.removeEventListener("visibilitychange", on);
}
