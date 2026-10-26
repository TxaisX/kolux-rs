import type { Project, Worktree } from "./model";

/** How many projects the sidebar asks Git about at once: a small pool, not 150 and not 1. */
export const SCAN_POOL = 4;

/** T-442-c: one project's answer from `workspace_scan`: its workspaces and the unseen outside ones. */
export type Scanned = { list: Worktree[]; unseen: Worktree[] };

export type ScanAnswer = { ok: Scanned } | { error: string };

/**
 * Asks `ask` for every project, at most `pool` at a time, and hands each answer to `onAnswer` the moment
 * it arrives, so the sidebar fills in project by project instead of after the whole sweep (T-442-c).
 * A failed ask is reported as an error answer and never stops the others.
 */
export async function scanProjects(
  projects: Project[],
  ask: (p: Project) => Promise<Scanned>,
  onAnswer: (p: Project, answer: ScanAnswer) => void,
  pool: number = SCAN_POOL,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < projects.length) {
      const p = projects[next++]!;
      let answer: ScanAnswer;
      try {
        answer = { ok: await ask(p) };
      } catch (err) {
        answer = { error: String(err) };
      }
      onAnswer(p, answer);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(pool, projects.length)) }, worker));
}

/**
 * Keeps a scan from overlapping itself. A poll tick that finds one running is skipped; an explicit
 * refresh (after a create, a delete) waits and then runs once, however many asked meanwhile.
 */
export class ScanGate {
  private running: Promise<void> | null = null;
  private queued: { task: () => Promise<void>; promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } | null = null;

  get busy(): boolean {
    return this.running !== null;
  }

  run(task: () => Promise<void>, opts: { skipIfBusy?: boolean } = {}): Promise<void> {
    if (!this.running) return this.start(task);
    if (opts.skipIfBusy) return Promise.resolve();
    // The latest asker's task is the one that runs; every waiter shares its finish.
    if (this.queued) {
      this.queued.task = task;
      return this.queued.promise;
    }
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.queued = { task, promise, resolve, reject };
    return promise;
  }

  private start(task: () => Promise<void>): Promise<void> {
    const now = task().finally(() => {
      this.running = null;
      const next = this.queued;
      this.queued = null;
      if (next) this.start(next.task).then(next.resolve, next.reject);
    });
    this.running = now;
    return now;
  }
}
