// The chooser's seats (SESS-007, SESS-013): each seat is one session to start, picked as an AI
// (or a plain terminal) plus, for an AI, a model. Pure: the pane renders these and App launches
// them. Nothing is guessed: an AI seat is ready only once its model is picked explicitly.

/** `agent` is an agent id, "terminal" for a plain shell, or null while unpicked. `model` is a
 * model id, "default" for "the program's own default" (an explicit pick), or null. `title` is
 * the seat's job title (SESS-024): it names the pane; blank means none. `prompt` is the opening
 * prompt (SESS-051), handed to the agent by its own route; blank means none. */
export type Seat = { agent: string | null; model: string | null; title?: string; prompt?: string };

export const TERMINAL = "terminal";

/** SESS-014: where the AIs work: a fresh worktree each, or the chooser's own folder for all. */
export type Copies = "separate" | "shared";

/** SESS-014: one copy per seat for 2+ seats in a Git project; the shared folder otherwise. */
export const defaultCopies = (seatCount: number, inGit: boolean): Copies => (inGit && seatCount >= 2 ? "separate" : "shared");

/** SESS-014: the shared folder with 2+ seats in a Git project is worth a warning. */
export const sharedWarning = (copies: Copies, seatCount: number, inGit: boolean): boolean => copies === "shared" && inGit && seatCount >= 2;

export const NOT_GIT = "Not a Git project: there is nothing to copy, so every AI works in this folder.";

/** The quick-pick counts (SESS-013: the rebuild settles on the New session page's set). */
export const QUICK_COUNTS = [1, 2, 3, 4, 6, 8];

export const emptySeat = (): Seat => ({ agent: null, model: null });

/** Grows with empty seats or shrinks from the bottom; never below one seat. */
export function resizeSeats(seats: Seat[], count: number): Seat[] {
  const n = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  if (n <= seats.length) return seats.slice(0, n);
  return [...seats, ...Array.from({ length: n - seats.length }, emptySeat)];
}

/** A seat whose agent is no longer among the installed ones is cleared, not swapped. */
export function clearMissing(seats: Seat[], installedIds: string[]): Seat[] {
  return seats.map((s) => (s.agent === null || s.agent === TERMINAL || installedIds.includes(s.agent) ? s : emptySeat()));
}

/** A terminal needs no model; an AI needs an explicit model pick. */
export function seatReady(s: Seat): boolean {
  return s.agent === TERMINAL || (s.agent !== null && s.model !== null);
}

export const allReady = (seats: Seat[]): boolean => seats.length > 0 && seats.every(seatReady);

/** SESS-015 "Same for all": the first finished seat's AI and model go into every other seat;
 * job titles stay per seat. Unchanged when no seat is finished. */
export function sameForAll(seats: Seat[]): Seat[] {
  const first = seats.find(seatReady);
  if (!first) return seats;
  return seats.map((s) => ({ ...s, agent: first.agent, model: first.model }));
}

/** SESS-024: a pane whose session failed to start is dropped. `batchEmpty` says the whole
 * lineup it came from is gone, so the window can say that nothing started. */
export function withoutFailed<T extends { key: number; batch?: number }>(panes: T[], key: number): { panes: T[]; batchEmpty: boolean } {
  const failed = panes.find((p) => p.key === key);
  const rest = panes.filter((p) => p.key !== key);
  const batchEmpty = failed?.batch !== undefined && !rest.some((p) => p.batch === failed.batch);
  return { panes: rest, batchEmpty };
}

/** A model choice: its id on the agent's command line and the label the user reads. */
export type ModelChoice = { id: string; label: string };

// ponytail: built-in lists only; SESS-029 (P1) asks the installed program for its live list.
const BUILT_IN: Record<string, ModelChoice[]> = {
  claude: [
    { id: "opus", label: "Claude Opus" },
    { id: "sonnet", label: "Claude Sonnet" },
    { id: "haiku", label: "Claude Haiku" },
  ],
  codex: [
    { id: "gpt-5-codex", label: "GPT-5 Codex" },
    { id: "gpt-5", label: "GPT-5" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  cursor: [
    { id: "auto", label: "Auto" },
    { id: "sonnet-4.5", label: "Claude Sonnet 4.5" },
    { id: "gpt-5", label: "GPT-5" },
  ],
  grok: [
    { id: "grok-code-fast-1", label: "Grok Code Fast 1" },
    { id: "grok-4", label: "Grok 4" },
  ],
};

export const DEFAULT_MODEL = "default";

/** The model row for an agent: its built-in list (when it has one) plus the program's own default,
 * which is an explicit pick that adds no model flag. */
export function modelsFor(agentId: string): ModelChoice[] {
  return [...(BUILT_IN[agentId] ?? []), { id: DEFAULT_MODEL, label: "Program default" }];
}

/** The arguments a model pick adds to the start line; none for the program's own default. */
export function modelArgs(model: string | null): string[] {
  return model === null || model === DEFAULT_MODEL ? [] : ["--model", model];
}
