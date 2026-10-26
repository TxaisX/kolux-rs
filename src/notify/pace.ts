// STAT-044 / T-125: desktop notifications are merged and paced. Repeats for one worktree inside the
// cooldown fold into the first one (a task-complete and a bell for the same event included); each
// agent event has a fixed identity so the same event is never shown twice; the memory of what was
// shown stays bounded during bursts; nothing is shown while the window has focus when that option
// is on; a test notification ignores all of it. Pure: the caller (useAgentEvents.noticed) keeps the
// memory between calls.

export const COOLDOWN_MS = 5_000;
/** How many identities the memory keeps; the oldest goes first. */
export const MEMORY_CAP = 64;

export type NotifyKind = "finish" | "stop" | "bell" | "quiet" | "test";
/** One agent event as the backend hears it: `id` is the click target key, `pane` the pane to focus. */
export type NotifyEvent = { id: string; worktree: string | null; pane: string | null; kind: NotifyKind };

export type PaceMemory = { shown: Map<string, number>; lastByDir: Map<string, number> };
export type PaceOptions = { cooldownMs?: number; focused?: boolean; quietWhenFocused?: boolean; test?: boolean };

export function newPaceMemory(): PaceMemory {
  return { shown: new Map(), lastByDir: new Map() };
}

const loadStamp = Date.now().toString(36);
let sequence = 0;
/** The identity of one agent event: a load stamp plus a process-wide counter, so two events are never
 * equal (same pane, same words, same millisecond included) and a reload never repeats an id the backend
 * still remembers. */
export function noteId(): string {
  sequence += 1;
  return `${loadStamp}.${sequence}`;
}

/** Whether to show this notification now; a `true` records it in the memory. */
export function paced(mem: PaceMemory, dir: string | null, id: string, now: number, opts: PaceOptions = {}): boolean {
  if (opts.test) return true;
  if (opts.focused && opts.quietWhenFocused) return false;
  if (mem.shown.has(id)) return false;
  const key = dir ?? "";
  const last = mem.lastByDir.get(key);
  const cooldown = opts.cooldownMs ?? COOLDOWN_MS;
  if (last !== undefined && now - last < cooldown) {
    remember(mem.shown, id, now); // merged into the one already showing: never shown later either
    return false;
  }
  remember(mem.shown, id, now);
  mem.lastByDir.set(key, now);
  return true;
}

function remember(m: Map<string, number>, id: string, now: number): void {
  m.set(id, now);
  while (m.size > MEMORY_CAP) m.delete(m.keys().next().value as string);
}
