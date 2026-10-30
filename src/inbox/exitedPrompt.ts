// T-035-b FIX-2: the open question or permission a program left behind when it exited, remembered for
// the Inbox alone. Pure, so the rule is tested here instead of living untested inside the window.
import type { AgentState } from "../projects/rows";
import type { Source } from "./inbox";
import { needsYou } from "../board/chip";

/** Pane key to the prompt state it left open. Never mutated: every function returns a new map, or the same one when nothing changed. */
export type Kept = Record<number, AgentState>;

/** Only a question or a permission is a prompt; a stop or a finish is not (T-608: the one needs-you rule). */
const isPrompt = (state: AgentState | undefined): state is AgentState => needsYou(state);

const without = (kept: Kept, keys: number[]): Kept => {
  if (!keys.some((k) => k in kept)) return kept;
  return Object.fromEntries(Object.entries(kept).filter(([k]) => !keys.includes(Number(k))));
};

/** A pane starts: forget its remembered prompt. A pane exits with `hookState` as its last hook state:
 *  remember an open prompt, replace an old one when it ended some other way, and change nothing when the
 *  hook state is already gone (the exit callback can run twice). */
export function onRunning(kept: Kept, key: number, running: boolean, hookState: AgentState | undefined): Kept {
  if (running) return without(kept, [key]);
  if (hookState === undefined) return kept;
  if (isPrompt(hookState)) return kept[key] === hookState ? kept : { ...kept, [key]: hookState };
  return without(kept, [key]);
}

/** Panes close: their remembered prompts go with them. */
export function onClose(kept: Kept, keys: number[]): Kept {
  return without(kept, keys);
}

/** The sources the Inbox reads: an exited pane that left a prompt open shows it as its state. The entry is
 *  dropped for good once the pane runs again, a fresh hook state arrived for it (that state wins), or the
 *  pane is no longer a source. */
export function inboxOverlay(sources: Source[], kept: Kept, hook: Partial<Record<number, AgentState>>): { sources: Source[]; kept: Kept } {
  if (Object.keys(kept).length === 0) return { sources, kept };
  const byKey = new Map(sources.map((s) => [s.key, s]));
  const stale = Object.keys(kept)
    .map(Number)
    .filter((k) => {
      const s = byKey.get(k);
      return !s || s.running || hook[k] !== undefined;
    });
  const left = without(kept, stale);
  return { sources: sources.map((s) => (s.key in left ? { ...s, state: left[s.key] } : s)), kept: left };
}
