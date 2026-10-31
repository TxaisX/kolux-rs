// PROJ-062 (T-609): the changed-file count a workspace card shows ("3 changed files"). Its source is the one
// the Source Control panel and the Inbox detail already use: the back end's `scm_status` for the worktree
// (git status), counted as distinct paths over staged, changed, untracked and conflicted files. The sidebar
// asks once per workspace when the cards show the count, again when the window is focused or an agent finishes
// there, one workspace at a time, and keeps each answer for a short while. A failed read keeps the last answer
// (or none): a card never shows an error.
// ponytail: scm_status is the panel's foreground read and returns the file lists, capped (GIT-012); a count-only
// background command in Rust would be lighter for many workspaces.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "../scm/model";
import { onFinish } from "../status/finished";

/** How many files differ from HEAD: each path once, wherever git lists it. */
export const changedCount = (s: Pick<Status, "staged" | "changed" | "untracked" | "conflicts">): number => new Set([...s.staged, ...s.changed, ...s.untracked, ...s.conflicts].map((c) => c.path)).size;

export type ChangesAsk = (path: string) => Promise<number>;

const keyOf = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export class CardChanges {
  private got = new Map<string, { at: number; count: number }>();
  private queue: string[] = [];
  private running = false;
  constructor(
    private ask: ChangesAsk,
    private changed: () => void = () => {},
    private now: () => number = Date.now,
    private ttl = 10_000,
  ) {}

  /** The last count read for the workspace; 0 before any read. */
  countFor(path: string): number {
    return this.got.get(keyOf(path))?.count ?? 0;
  }

  /** Reads each workspace that has no fresh answer, one at a time; `force` reads them even when fresh. */
  async load(paths: readonly string[], force = false): Promise<void> {
    for (const p of paths) {
      const held = this.got.get(keyOf(p));
      if (!force && held && this.now() - held.at < this.ttl) continue;
      if (!this.queue.some((q) => keyOf(q) === keyOf(p))) this.queue.push(p);
    }
    if (this.running) return;
    this.running = true;
    try {
      for (let p = this.queue.shift(); p !== undefined; p = this.queue.shift()) {
        const k = keyOf(p);
        const held = this.got.get(k);
        try {
          const count = await this.ask(p);
          this.got.set(k, { at: this.now(), count });
          if (count !== (held?.count ?? 0)) this.changed();
        } catch {
          if (held) this.got.set(k, { ...held, at: this.now() });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

const askBackEnd: ChangesAsk = (path) => invoke<Status>("scm_status", { worktree: path }).then(changedCount);

const same = (a: string, b: string) => keyOf(a) === keyOf(b);

/** The sidebar's hook: `countFor(path)` for a card's facts. While `on` (a card or its hover shows the count), every
 *  listed workspace is read, then again on focus, and the one an agent finished in at once. `load(path)` reads one
 *  (the pointer entering a card, for the hover). */
export function useCardChanges(paths: readonly string[], on: boolean): { countFor: (path: string) => number; load: (path: string) => void } {
  const [, bump] = useState(0);
  const cache = useRef<CardChanges | null>(null);
  cache.current ??= new CardChanges(askBackEnd, () => bump((n) => n + 1));
  const key = JSON.stringify(paths);
  useEffect(() => {
    if (!on) return;
    const c = cache.current!;
    void c.load(paths);
    const focus = () => void c.load(paths);
    window.addEventListener("focus", focus);
    const off = onFinish((cwd) => {
      const hit = paths.find((p) => same(p, cwd));
      if (hit) void c.load([hit], true);
    });
    return () => {
      window.removeEventListener("focus", focus);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);
  const countFor = useCallback((path: string) => cache.current!.countFor(path), []);
  const load = useCallback((path: string) => void cache.current!.load([path]), []);
  return { countFor, load };
}
