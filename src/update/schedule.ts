// APP-024: the quiet update timetable. Pure logic over an injected clock, so every rule is tested
// with fake time (schedule.test.ts). The back end does the check itself (src-tauri/src/update.rs).
//
// - At start a check runs only if the last one is older than the interval; otherwise it waits out
//   the remainder. From then on it checks every 30 minutes.
// - Checks set off by the window gaining focus, and a requested check during a running one, share
//   the running check; they never pile up.
// - A failed check is retried after an hour, doubling each time up to six hours.
// - Offline it stays silent and checks within a few seconds of the connection coming back.
// - Waking from sleep (the minute tick finds a gap) checks if the last check is out of date.
// - A check that never answers is dropped after a timeout and counts as a failure.
// - APP-031: a feed with nothing to install is no failure. A release whose installer is not
//   uploaded yet is looked at again after a few minutes; a missing manifest or a release with no
//   download for this computer waits for the normal interval.

export const INTERVAL_MS = 30 * 60_000;
export const RETRY_BASE_MS = 60 * 60_000;
export const RETRY_MAX_MS = 6 * 60 * 60_000;
export const ONLINE_DELAY_MS = 5_000;
export const TICK_MS = 60_000;
export const WAKE_GAP_MS = 3 * 60_000;
export const CHECK_TIMEOUT_MS = 45_000;
export const RECHECK_SOON_MS = 5 * 60_000;

/** APP-031: why a check that reached the feed has nothing to offer. */
export type Quiet = "halfPublished" | "noManifest" | "noPlatform" | "refused";
/** What a check returns when the feed answered but has nothing to install. */
export class Quietly {
  constructor(readonly reason: Quiet) {}
}

export type Outcome<T> = { ok: true; found: T | null; quiet?: Quiet } | { ok: false; error: string; offline: boolean };

export interface ScheduleDeps<T> {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  online(): boolean;
  check(): Promise<T | null | Quietly>;
  /** Called after every finished check, quiet or requested. */
  onOutcome?(outcome: Outcome<T>, requested: boolean): void;
}

/** The wait after the n-th failure in a row (n >= 1). */
export function retryDelay(failures: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
}

export class UpdateSchedule<T> {
  private timer: unknown = null;
  private inFlight: Promise<Outcome<T>> | null = null;
  private requested = false;
  private failures = 0;
  private missedOffline = false;
  private lastTick: number;
  /** Time of the last check that got an answer (ms since epoch), from the store at start. */
  lastCheckAt: number | null;

  constructor(private deps: ScheduleDeps<T>, lastCheckAt: number | null) {
    this.lastCheckAt = lastCheckAt;
    this.lastTick = deps.now();
  }

  get failureCount() {
    return this.failures;
  }
  get running() {
    return this.inFlight !== null;
  }

  private due(): boolean {
    return this.lastCheckAt === null || this.deps.now() - this.lastCheckAt >= INTERVAL_MS;
  }

  private schedule(ms: number) {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.run(false);
    }, Math.max(0, ms));
  }

  start() {
    if (this.due()) void this.run(false);
    else this.schedule(INTERVAL_MS - (this.deps.now() - (this.lastCheckAt as number)));
  }

  stop() {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** A check. Quiet (`requested` false) checks skip while offline; a running check is shared,
   *  and a request during a quiet check takes it over (its result is reported as requested). */
  run(requested: boolean): Promise<Outcome<T>> {
    if (requested) this.requested = true;
    if (this.inFlight) return this.inFlight;
    if (!requested && !this.deps.online()) {
      this.missedOffline = true;
      this.schedule(INTERVAL_MS);
      return Promise.resolve({ ok: false, error: "offline", offline: true });
    }
    this.requested = requested;
    const p = this.attempt().then((outcome) => {
      this.inFlight = null;
      const asked = this.requested;
      this.requested = false;
      if (outcome.ok) {
        this.failures = 0;
        this.missedOffline = false;
        this.lastCheckAt = this.deps.now();
        this.schedule(outcome.quiet === "halfPublished" ? RECHECK_SOON_MS : INTERVAL_MS);
      } else {
        this.failures += 1;
        if (outcome.offline) this.missedOffline = true;
        this.schedule(retryDelay(this.failures));
      }
      this.deps.onOutcome?.(outcome, asked);
      return outcome;
    });
    this.inFlight = p;
    return p;
  }

  private attempt(): Promise<Outcome<T>> {
    return new Promise((resolve) => {
      let settled = false;
      const timeout = this.deps.setTimer(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: `The update check got no answer within ${CHECK_TIMEOUT_MS / 1000} seconds.`, offline: !this.deps.online() });
      }, CHECK_TIMEOUT_MS);
      this.deps.check().then(
        (found) => {
          if (settled) return;
          settled = true;
          this.deps.clearTimer(timeout);
          resolve(found instanceof Quietly ? { ok: true, found: null, quiet: found.reason } : { ok: true, found });
        },
        (e) => {
          if (settled) return;
          settled = true;
          this.deps.clearTimer(timeout);
          resolve({ ok: false, error: String(e), offline: !this.deps.online() });
        },
      );
    });
  }

  /** The window gained focus. */
  focus() {
    if (this.due() && this.failures === 0) void this.run(false);
  }

  /** The connection came back. */
  online() {
    if (this.missedOffline || this.due()) this.schedule(ONLINE_DELAY_MS);
  }

  /** Called every TICK_MS; a long gap since the last tick means the PC slept. */
  tick() {
    const now = this.deps.now();
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (gap > WAKE_GAP_MS && this.due()) void this.run(false);
  }
}
