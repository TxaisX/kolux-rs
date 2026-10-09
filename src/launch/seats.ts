// The chooser's seats (SESS-007, SESS-013): each seat is one session to start, picked as an AI
// (or a plain terminal) plus, for an AI, a model. Pure: the pane renders these and App launches
// them. Nothing is guessed: an AI seat is ready only once its model is picked explicitly.

/** `agent` is an agent id, "terminal" for a plain shell, or null while unpicked. `model` is a
 * model id, "default" for "the program's own default" (an explicit pick), or null. */
export type Seat = { agent: string | null; model: string | null };

export const TERMINAL = "terminal";

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
