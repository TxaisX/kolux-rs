// BROW-052 / T-319-c: a drag that starts in the app crosses browser pages. Each page is a child
// web view that takes the pointer from the app, so while a drag is under way the back end lets
// the pointer through the pages (browser_drag_through). The state machine below turns "a drag
// started" and "a drag ended, however it ended" into those calls: pages are given back on drop,
// cancel, Esc, pointer-up, window blur and at start-up, and the back end also gives them back by
// itself when the renewals stop.

export type Kind = "html5" | "pointer";
export type Send = (on: boolean) => void;

/** Numbers each call to the back end so one that overtakes an earlier one is not undone by it. Starts
 *  at the clock, so a reloaded window's numbers stay above the old window's. */
export function createSeq(now: () => number = () => Date.now()): () => number {
  let last = 0;
  return () => (last = Math.max(now(), last + 1));
}

export type Gate = {
  begin(kind: Kind): void;
  end(kind: Kind): void;
  /** Ends every kind of drag: Esc, blur, start-up. */
  reset(): void;
  /** Says "still going" again; nothing when no drag is under way. */
  renew(): void;
  readonly on: boolean;
};

/** Pages let the pointer through while at least one kind of drag is under way. `send` is called on
 *  each change, so two overlapping kinds still start and end it once. */
export function createDragGate(send: Send, again: Send = send): Gate {
  const active = new Set<Kind>();
  let told = false;
  const settle = () => {
    const want = active.size > 0;
    if (want === told) return;
    told = want;
    send(want);
  };
  return {
    begin(kind) {
      active.add(kind);
      settle();
    },
    end(kind) {
      active.delete(kind);
      settle();
    },
    reset() {
      active.clear();
      settle();
    },
    renew() {
      if (told) again(true);
    },
    get on() {
      return told;
    },
  };
}

/** A press that moves this far (pixels) before it is released is a drag, not a click. */
export const DRAG_SLOP = 6;
/** How often a drag in progress is told to the back end again (its dead-man timer is 60 s). */
export const RENEW_MS = 20_000;
/** Events this soon after a drag began are the drag's own start-up, not proof it ended. */
export const GRACE_MS = 250;

type Pointerish = Event & { clientX?: number; clientY?: number; buttons?: number; button?: number };

/** Hooks the window's events to a gate. Returns the stop function. `now` and `send` are injectable. */
export function installDragThrough(target: EventTarget, send: Send, now: () => number = () => Date.now()): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  // Any sign the drag is alive since the last renewal; a drag over a page is seen by the app view only.
  let alive = false;
  const gate = createDragGate(
    (on) => {
      send(on);
      if (on) {
        alive = false;
        timer = setInterval(() => {
          // No dragover/drag/button-down move for a whole interval: the dragend was missed, so give the pages back.
          if (alive) {
            alive = false;
            gate.renew();
          } else gate.reset();
        }, RENEW_MS);
      }
      else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    send,
  );
  let since = 0;
  let armed: { x: number; y: number } | null = null;
  const young = () => now() - since < GRACE_MS;
  const begin = (kind: Kind) => {
    if (!gate.on) since = now();
    gate.begin(kind);
  };

  const on = (type: string, fn: (e: Pointerish) => void) => {
    const handler = fn as EventListener;
    target.addEventListener(type, handler, { capture: true });
    return () => target.removeEventListener(type, handler, { capture: true });
  };
  const offs = [
    on("dragstart", () => begin("html5")),
    // dragend is on the source, which a re-render may have removed; drop is on the target.
    on("dragend", () => gate.end("html5")),
    on("dragover", () => (alive = true)),
    on("drag", () => (alive = true)),
    on("drop", () => gate.end("html5")),
    on("pointerdown", (e) => {
      armed = e.button === 0 || e.button === undefined ? { x: e.clientX ?? 0, y: e.clientY ?? 0 } : null;
    }),
    on("pointermove", (e) => {
      const down = ((e.buttons ?? 0) & 1) === 1;
      if (down) alive = true;
      if (!down) {
        armed = null;
        gate.end("pointer");
        // A mouse moving with no button down after an HTML5 drag proves it ended (a lost dragend).
        if (!young()) gate.end("html5");
        return;
      }
      if (armed && Math.hypot((e.clientX ?? 0) - armed.x, (e.clientY ?? 0) - armed.y) >= DRAG_SLOP) begin("pointer");
    }),
    on("pointerup", () => {
      armed = null;
      gate.end("pointer");
      if (!young()) gate.end("html5");
    }),
    on("pointercancel", () => {
      armed = null;
      gate.end("pointer");
    }),
    on("lostpointercapture", () => {
      armed = null;
      gate.end("pointer");
    }),
    on("keydown", (e) => {
      if ((e as Event & { key?: string }).key === "Escape") {
        armed = null;
        gate.reset();
      }
    }),
    on("blur", () => {
      armed = null;
      if (!young()) gate.reset();
    }),
    on("visibilitychange", () => {
      armed = null;
      gate.reset();
    }),
  ];
  // A reloaded window may have left pages let through by the one before it.
  send(false);
  return () => {
    for (const off of offs) off();
    gate.reset();
  };
}
