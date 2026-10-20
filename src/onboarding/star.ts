// ONB-037 / ONB-038 (T-322-b): the GitHub star prompt as pure rules: when it shows, what a dismissal does, and the
// states of starring. It never stars by itself: only the user's click on the star button calls `put`. The prompt is
// off until the app has a public repository (OD-16): the Rust side answers an empty repository and the card stays away.

export const STAR_THRESHOLD = 35;
export const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
/** Other live agents and typing must have been quiet this long before the finished-task moment (ONB-037). */
export const QUIET_MS = 1000;
export const STAR_SETTING = "starPrompt";

export type StarState = {
  /** The app version the baseline was taken for. */
  version: string | null;
  /** The agents-launched count when the baseline was taken. */
  baseline: number;
  /** How many launches since the baseline show the card; 'Later' doubles it. */
  threshold: number;
  cooldownUntil: number;
  completed: boolean;
  /** The app version whose finished-task moment is spent. */
  taskSpent: string | null;
};

export const fresh = (): StarState => ({ version: null, baseline: 0, threshold: STAR_THRESHOLD, cooldownUntil: 0, completed: false, taskSpent: null });

/** The saved record, tolerant: a damaged field falls back to its default, never throws. */
export function stateOf(raw: unknown): StarState {
  const d = fresh();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, or: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : or);
  return {
    version: typeof r.version === "string" ? r.version : null,
    baseline: num(r.baseline, 0),
    threshold: Math.max(1, num(r.threshold, STAR_THRESHOLD)),
    cooldownUntil: num(r.cooldownUntil, 0),
    completed: r.completed === true,
    taskSpent: typeof r.taskSpent === "string" ? r.taskSpent : null,
  };
}

/** Each update takes a new baseline unless the user already completed the prompt. */
export function withVersion(s: StarState, version: string, launched: number): StarState {
  if (s.version === version) return s;
  return s.completed ? { ...s, version } : { ...s, version, baseline: launched };
}

/** `starred` is null when it could not be checked. `window` is whether any window can take a prompt. */
export type Ctx = { now: number; starred: boolean | null; window: boolean; forced?: boolean };

/** Nothing shows during a cooldown (a forced show skips it), after completion, once starred, or with no window. */
const held = (s: StarState, c: Ctx) => s.completed || c.starred === true || !c.window || (!c.forced && c.now < s.cooldownUntil);

/** The threshold card: enough launches since the baseline. */
export const thresholdDue = (s: StarState, launched: number, c: Ctx): boolean => !held(s, c) && launched - s.baseline >= s.threshold;

/** The onboarding-complete toast. */
export const onboardingToast = (s: StarState, c: Ctx): boolean => !held(s, c);

/** The finished-task moment: once per app version, after a prompted session completed without interruption and
 *  everything else has been quiet for `QUIET_MS`. A moment that comes during a cooldown is spent for the version;
 *  one that finds no window is not spent. */
export function finishedTask(s: StarState, version: string, c: Ctx, o: { clean: boolean; quietMs: number }): { show: boolean; state: StarState } {
  const spent = { ...s, taskSpent: version };
  if (s.taskSpent === version || s.completed || c.starred === true || !o.clean || o.quietMs < QUIET_MS) return { show: false, state: s };
  if (!c.window) return { show: false, state: s };
  if (!c.forced && c.now < s.cooldownUntil) return { show: false, state: spent };
  return { show: true, state: spent };
}

// ---- what is on screen ----

export type Screen = { shown: { id: number; kind: "card" | "toast" } | null; next: number; dismissed: number | null };
export const emptyScreen = (): Screen => ({ shown: null, next: 1, dismissed: null });

/** A toast replaces a card; a card never replaces a toast. */
export function showing(sc: Screen, kind: "card" | "toast"): Screen {
  if (sc.shown?.kind === "toast" && kind === "card") return sc;
  return { ...sc, shown: { id: sc.next, kind }, next: sc.next + 1 };
}

/** Replacing or hiding the toast is not the user dismissing it. */
export const hidden = (sc: Screen): Screen => ({ ...sc, shown: null });

/** A dismissal ('Later' or Dismiss) counts only while a prompt is on screen, and once per prompt: it starts the
 *  three-day cooldown, doubles the next threshold and takes a new baseline. */
export function dismissed(s: StarState, sc: Screen, now: number, launched: number): { state: StarState; screen: Screen } {
  if (!sc.shown || sc.dismissed === sc.shown.id) return { state: s, screen: sc };
  return {
    state: { ...s, cooldownUntil: now + COOLDOWN_MS, threshold: s.threshold * 2, baseline: launched },
    screen: { ...sc, shown: null, dismissed: sc.shown.id },
  };
}

/** The user starred (or was found to have starred): the prompt is complete for good. */
export const completedState = (s: StarState): StarState => ({ ...s, completed: true });

// ---- starring (ONB-038) ----

export type StarUi = "idle" | "busy" | "thanks" | "fallback";
export type StarIo = { check: () => Promise<boolean | null>; put: () => Promise<void> };

/** One prompt's star button. Success shows only after the direct star worked; a check that cannot tell offers the
 *  browser fallback; a failed star switches to the fallback; a second click while busy is ignored; Dismiss and
 *  closing are disabled while busy; an attempt that failed can be tried again. */
export function createStar(io: StarIo, onChange: (ui: StarUi) => void = () => {}) {
  let ui: StarUi = "idle";
  let gone = false;
  const set = (u: StarUi) => {
    ui = u;
    if (!gone) onChange(u);
  };
  return {
    ui: () => ui,
    canDismiss: () => ui !== "busy",
    /** The prompt was taken off screen some other way; a result that arrives later brings nothing back. */
    abandon() {
      gone = true;
    },
    async click(): Promise<StarUi> {
      if (ui === "busy" || ui === "thanks") return ui;
      set("busy");
      let starred: boolean | null = null;
      try {
        starred = await io.check();
      } catch {
        starred = null;
      }
      if (starred === null) return (set("fallback"), ui);
      if (starred) return (set("thanks"), ui);
      try {
        await io.put();
        set("thanks");
      } catch {
        set("fallback");
      }
      return ui;
    },
  };
}

/** The landing-screen star: it changes at once, before the answer arrives, and goes back to the fallback if it fails. */
export async function landingStar(put: () => Promise<void>, set: (s: { starred: boolean; fallback: boolean }) => void): Promise<void> {
  set({ starred: true, fallback: false });
  try {
    await put();
  } catch {
    set({ starred: false, fallback: true });
  }
}

// ---- other lanes tell the prompt what happened ----

export const STAR_EVENT = "kolux-star";
export type StarEvent = { kind: "launch" } | { kind: "onboarding-done" } | { kind: "task-finished"; clean: boolean; quietMs: number };
export const tellStar = (e: StarEvent) => window.dispatchEvent(new CustomEvent(STAR_EVENT, { detail: e }));

/** ONB-007 / ONB-037: a stored completed close of the first-run wizard asks for the onboarding-finished toast. */
export const starAfterClose = (outcome: string) => {
  if (outcome === "completed") tellStar({ kind: "onboarding-done" });
};

/** The part of an agent's status report (the agent-status event) the star prompt reads. */
export type StarHook = { paneKey: number; state?: string; fresh?: boolean; child?: string };

/**
 * Row 308 (ONB-037): turns the agents' status reports into the prompt's moments. A started agent
 * (a fresh session, not a sub-agent) is one launch; a turn that began with a prompt and ends done is
 * a finished task, clean unless it was interrupted or blocked on the way, told once the other panes'
 * reports and the user's typing have been quiet for QUIET_MS.
 */
export function createStarFeed(
  tell: (e: StarEvent) => void,
  now: () => number = Date.now,
  later: (fn: () => void, ms: number) => () => void = (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
) {
  const turns = new Map<number, { clean: boolean }>();
  let busyAt = Number.NEGATIVE_INFINITY;
  let waiting: { clean: boolean; pane: number; cancel: () => void } | null = null;
  const whenQuiet = () => {
    if (!waiting) return;
    const quiet = now() - busyAt;
    if (quiet >= QUIET_MS) {
      const { clean } = waiting;
      waiting = null;
      tell({ kind: "task-finished", clean, quietMs: quiet });
    } else waiting.cancel = later(whenQuiet, QUIET_MS - quiet);
  };
  const busy = () => {
    busyAt = now();
  };
  return {
    hook(h: StarHook) {
      if (h.child) return;
      // Any other pane's report is activity.
      if (!waiting || h.paneKey !== waiting.pane) busy();
      if (h.fresh) {
        // A new process starts with no turn open.
        turns.delete(h.paneKey);
        tell({ kind: "launch" });
      }
      const turn = turns.get(h.paneKey);
      if (h.state === "working") {
        if (!turn) turns.set(h.paneKey, { clean: true });
      } else if (h.state === "interrupted" || h.state === "blocked") {
        if (turn) turn.clean = false;
      } else if (h.state === "done" && turn) {
        turns.delete(h.paneKey);
        waiting?.cancel();
        // The quiet second is counted from the finish on.
        busy();
        waiting = { clean: turn.clean, pane: h.paneKey, cancel: () => {} };
        whenQuiet();
      }
    },
    typed: busy,
    stop: () => waiting?.cancel(),
  };
}
