// The chooser's seats (SESS-007, SESS-013): each seat is one session to start, picked as an AI
// (or a plain terminal) plus, for an AI, a model. Pure: the pane renders these and App launches
// them. Nothing is guessed: an AI seat is ready only once its model is picked explicitly.

/** `agent` is an agent id, "terminal" for a plain shell, or null while unpicked. `model` is a
 * model id, "default" for "the program's own default" (an explicit pick), or null. `title` is
 * the seat's job title (SESS-024): it names the pane; blank means none. `prompt` is the opening
 * prompt (SESS-051), handed to the agent by its own route; blank means none. `role` is the seat's
 * role in a launch shape (SESS-012); none in Custom. */
export type Seat = { agent: string | null; model: string | null; title?: string; prompt?: string; role?: Role };

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
  return s.agent === TERMINAL || (s.agent !== null && (s.model !== null || modelsFor(s.agent).length === 0));
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

// ponytail: built-in lists only (ACCT-032); the live per-account lookup is SESS-029 (T-100).
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

/** The model row for an agent: its built-in list plus the program's own default, which is an
 * explicit pick that adds no model flag. ACCT-032: an agent without a built-in list has no model
 * step at all (empty). */
export function modelsFor(agentId: string): ModelChoice[] {
  const list = BUILT_IN[agentId];
  return list ? [...list, { id: DEFAULT_MODEL, label: "Program default" }] : [];
}

/** The arguments a model pick adds to the start line; none for the program's own default. */
export function modelArgs(model: string | null): string[] {
  return model === null || model === DEFAULT_MODEL ? [] : ["--model", model];
}

/** SESS-012: the four roles, each with its own short brief that goes ahead of the shared task. */
export type Role = "builder" | "reviewer" | "scout" | "tester";
export const ROLE_BRIEFS: Record<Role, string> = {
  builder: "You are the builder. Make the change the task asks for in small steps, and keep the project working after each one.",
  reviewer: "You are the reviewer. Read what the builders change, look for bugs, gaps and risky shortcuts, and say plainly what must be fixed before the task is done.",
  scout: "You are the scout. Before anyone builds, explore the code and the documentation the task touches, then write down what the others need to know: where things live, what already exists, and what could go wrong.",
  tester: "You are the tester. Write and run tests for what the task asks, try the edge cases, and report each failure with the exact steps that show it.",
};

/** SESS-012: a launch shape and the roles of its seats in order; Custom carries none. */
export type Shape = "solo" | "pair" | "workbench" | "swarm" | "custom";
export const SHAPES: Array<{ id: Shape; label: string; roles: Role[] }> = [
  { id: "solo", label: "Solo", roles: ["builder"] },
  { id: "pair", label: "Pair", roles: ["builder", "reviewer"] },
  { id: "workbench", label: "Workbench", roles: ["scout", "builder", "reviewer"] },
  { id: "swarm", label: "Swarm", roles: ["scout", "builder", "builder", "tester", "reviewer"] },
  { id: "custom", label: "Custom", roles: [] },
];
const rolesOf = (shape: Shape): Role[] => SHAPES.find((s) => s.id === shape)?.roles ?? [];
/** Seats past the end of the role list wrap round to its first role again. */
const withRoles = (seats: Seat[], roles: Role[]): Seat[] => seats.map((s, i) => ({ ...s, role: roles.length ? roles[i % roles.length] : undefined }));

/** SESS-012: picking a shape sets the count to its number of roles; Custom keeps the count. */
export function pickShape(shape: Shape, seats: Seat[]): Seat[] {
  const roles = rolesOf(shape);
  return withRoles(roles.length ? resizeSeats(seats, roles.length) : seats, roles);
}

/** SESS-012: a new count keeps the shape when it is at least the shape's number of roles;
 * below that the shape turns into Custom and the roles go. */
export function resizeLineup(shape: Shape, seats: Seat[], count: number): { shape: Shape; seats: Seat[] } {
  const next = resizeSeats(seats, count);
  const roles = rolesOf(shape);
  return next.length < roles.length ? { shape: "custom", seats: withRoles(next, []) } : { shape, seats: withRoles(next, roles) };
}

/** SESS-025: the first line of the rules block, which is how a shown prompt finds and cuts it. */
export const RULES_MARK = "--- Kolux: you are working alongside other agents ---";

/** SESS-025: the rules every agent of a 2+ seat launch gets after its task. `note` is the path of
 * its own handoff note, made before the agent starts. */
export function rulesBlock(note: string): string {
  return [
    RULES_MARK,
    "Other agents are working on this task alongside you at the same time.",
    "Stay inside your own worktree, the folder you started in. The one file outside it you may write is your handoff note.",
    `Your handoff note is ${note}. It exists already. Keep it current after each change: the files you added, updated and removed, and what is left to do. Never edit another agent's note.`,
    "Before you say you are done, check how you use every library against its up-to-date documentation.",
  ].join("\n");
}

/** SESS-012 / SESS-025: a seat's first message: its role's brief, then the shared task, then the
 * seat's own opening prompt (SESS-051), blank parts left out; then the rules block when given.
 * Empty when there is nothing to say, so no rules block goes out alone. */
// ponytail: a prompt with line breaks reaches a typed-route agent, or one started through a .cmd
// shim, only up to its first line break; T-163 (SESS-032) delivers it as one pasted block.
export function openingPrompt(seat: Seat, task: string, rules: string | null): string {
  const body = [seat.role ? ROLE_BRIEFS[seat.role] : "", task.trim(), seat.prompt?.trim() ?? ""].filter(Boolean).join("\n\n");
  return body && rules ? `${body}\n\n${rules}` : body;
}

/** SESS-025: a prompt as it is shown back to the user: everything from the rules block on is cut.
 * The pane tooltip shows the task alone; the status of STAT-025 (T-123) and the session rows of
 * VIEW-084 (T-127) run prompts through this. */
export function withoutRules(text: string): string {
  const at = text.indexOf(RULES_MARK);
  return at < 0 ? text : text.slice(0, at).trimEnd();
}

/** SESS-020: a lineup saved under a name to pick again: each seat's AI, model, role, job title and
 * opening prompt, where the AIs work, and the shared task. */
export type SavedShape = { name: string; seats: Seat[]; copies: Copies; task?: string };
export const SAVED_SHAPES_KEY = "savedShapes";
export const SHAPE_LIMITS = { shapes: 40, name: 60, seats: 12, prompt: 4000 };

/** A name not taken by another saved shape (compared without case), with a rising number when it is. */
function freeName(list: SavedShape[], name: string, skip = -1): string {
  const taken = new Set(list.filter((_, i) => i !== skip).map((s) => s.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const tail = n === 1 ? "" : ` ${n}`;
    const out = name.slice(0, SHAPE_LIMITS.name - tail.length).trimEnd() + tail;
    if (!taken.has(out.toLowerCase())) return out;
  }
}

/** SESS-020: adds the lineup to the saved shapes, or says why it cannot. */
export function saveShape(list: SavedShape[], name: string, seats: Seat[], copies: Copies, task: string): { list: SavedShape[] } | { error: string } {
  if (!allReady(seats)) return { error: "Pick an AI and a model (or Terminal) for every seat before saving" };
  if (!name.trim()) return { error: "Give the shape a name" };
  if (seats.length > SHAPE_LIMITS.seats) return { error: `A saved shape holds at most ${SHAPE_LIMITS.seats} seats` };
  if (list.length >= SHAPE_LIMITS.shapes) return { error: `There are already ${SHAPE_LIMITS.shapes} saved shapes; delete one first` };
  const cut = (p: string) => p.slice(0, SHAPE_LIMITS.prompt);
  const shape: SavedShape = { name: freeName(list, name.trim()), seats: seats.map((s) => (s.prompt ? { ...s, prompt: cut(s.prompt) } : s)), copies, task: cut(task) };
  return { list: [...list, shape] };
}

/** SESS-020: a blank name changes nothing; only shape `i` is touched. */
export function renameShape(list: SavedShape[], i: number, name: string): SavedShape[] {
  if (!name.trim() || !list[i]) return list;
  return list.map((s, j) => (j === i ? { ...s, name: freeName(list, name.trim(), i) } : s));
}

/** SESS-020: the seats back as saved; a seat whose agent is no longer installed comes back blank. */
export const restoreShape = (shape: SavedShape, installedIds: string[]): Seat[] => clearMissing(shape.seats.map((s) => ({ ...s })), installedIds);
