// SKILL-027 / VIEW-100: the status bar's skill update item. This store owns the poll of the running
// update (so it keeps going when the Skills page or its dialog is closed), feeds the pure rules in
// skillBar.ts and runs the fade timer. The clock, the timers and the app calls are injected so a
// test can drive it with fake timers; the module-level `skillBar` is the one the app uses.
import { invoke } from "@tauri-apps/api/core";
import { IDLE, barItem, barReduce, nextChange, settle, type BarItem, type BarRun } from "./skillBar";
import type { UpdateStatus } from "./updateNotice";

export type Clock = { now: () => number; setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
export type Call = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
export type View = { run: BarRun; status: UpdateStatus | null; item: BarItem | null };

/** Raised when the user clicks the item: whoever owns the Skills page shows it and the details dialog. */
export const SKILLS_SHOW_EVENT = "kolux-skills-update-show";
export const POLL_MS = 500;

const realClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

export function createSkillBar(call: Call, clock: Clock = realClock, show: () => void = () => window.dispatchEvent(new Event(SKILLS_SHOW_EVENT))) {
  let run: BarRun = IDLE;
  let status: UpdateStatus | null = null;
  let wants = false;
  let poll: unknown;
  let fade: unknown;
  let polling = false;
  const listeners = new Set<() => void>();
  let view: View = { run, status, item: null };

  const publish = () => {
    clock.clearTimeout(fade);
    fade = undefined;
    run = settle(run, clock.now());
    const wait = nextChange(run, clock.now());
    if (wait != null) fade = clock.setTimeout(publish, wait);
    view = { run, status, item: barItem(run, clock.now()) };
    listeners.forEach((l) => l());
  };

  const feed = (s: UpdateStatus) => {
    status = s;
    run = barReduce(run, { type: "status", status: s, now: clock.now() });
    publish();
  };

  const tick = () => {
    poll = undefined;
    call<UpdateStatus>("skills_update_status").then(
      (s) => {
        if (!polling) return;
        feed(s);
        if (s.state === "done" || s.state === "idle") polling = false;
        else poll = clock.setTimeout(tick, POLL_MS);
      },
      () => {
        polling = false;
      },
    );
  };

  return {
    get: (): View => view,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    /** Follows the update that is running (or about to finish) until it is done. */
    watch() {
      if (polling) return;
      polling = true;
      clock.clearTimeout(poll);
      tick();
    },
    /** The Skills page opening: pick up a run that is already going, without inventing one. */
    sync() {
      call<UpdateStatus>("skills_update_status").then((s) => {
        if (s.state === "running" || s.state === "stopping") {
          feed(s);
          this.watch();
        }
      }, () => undefined);
    },
    /** The dialog opened or closed: while it is open the green check stays. */
    reading(open: boolean) {
      run = barReduce(run, { type: "reading", open, now: clock.now() });
      publish();
    },
    /** The item was clicked. A failure is acknowledged (gone), and the dialog is asked for. */
    click() {
      wants = true;
      const failed = run.phase === "failed";
      run = barReduce(run, { type: "click" });
      publish();
      if (failed) call("skills_update_clear").catch(() => undefined);
      show();
    },
    /** True once after a click, for a Skills page that was not up yet. */
    takeWanted(): boolean {
      const w = wants;
      wants = false;
      return w;
    },
    /** The last full report of the run, kept so the dialog can show it again after it was closed. */
    lastStatus: (): UpdateStatus | null => status,
    /** An update was just started for these skills: show it at once and follow it to the end. */
    begin(names: string[]) {
      polling = false;
      clock.clearTimeout(poll);
      run = IDLE;
      feed({ state: "running", names, command: "", log: "", code: null, stopped: false, error: null, results: [] });
      this.watch();
    },
    dispose() {
      polling = false;
      clock.clearTimeout(poll);
      clock.clearTimeout(fade);
      listeners.clear();
    },
  };
}

export const skillBar = createSkillBar((cmd, args) => invoke(cmd, args));
