// SKILL-006..010: what a running kit tells each AI, and what its strip shows per role. Pure, so
// the rules are tested on their own; App starts the seats and KitStrip draws the rows.
import { RESULTS_FOLDER, VENDOR_NAME, type Kit, type KitRole, type Vendor } from "./catalog";

/** SKILL-014: one run in the history across projects (newest 50 kept by the app). */
export type Past = { dir: string; kit: string; title: string; started: number; collected: string | null };

/** COMPAT: each role finishes by writing this marker in its own folder. */
export const MARKER = "DONE";

export type RunRecord = { kit: string; title: string; started: number; roles: { id: string; ai: string }[] };
/** The run in a folder and every file in each role's folder with its change time (ms). */
export type RunCheck = { record: RunRecord; files: Record<string, Record<string, number>> };

/** SKILL-006: a seat's title, the role then its AI. */
export const seatTitle = (role: KitRole, ai: Vendor) => `${role.title} · ${VENDOR_NAME[ai]}`;

/** SKILL-007: the role's prompt with the user's values in, then the fixed rules, on one line so a
 * waiting seat can be sent it as typed text. A blank optional input becomes empty text. */
export function rolePrompt(kit: Kit, role: KitRole, values: Record<string, string>): string {
  const known = new Set(kit.inputs.map((i) => i.id));
  const task = role.prompt.replace(/\{(\w+)\}/g, (all, id: string) => (known.has(id) ? (values[id] ?? "").trim() : all));
  const mine = `${RESULTS_FOLDER}/${role.id}/`;
  const rules = [
    "You may read the input files, but never edit, move or delete any file that is already there.",
    `Write only inside the folder ${mine} in this project.`,
    "Do not install any software; your built-in tools are fine for any sums.",
    "Hand over Markdown, CSV, or one self-contained HTML page whose charts are inline SVG and which loads no outside scripts.",
    `Produce exactly these files in ${mine}: ${role.delivers.join(", ")}.`,
    "Write for a reader who is short on time, such as a manager, and keep these rules and the marker file out of what you hand over.",
    `When everything is written, finish by writing a one-line file named ${MARKER} in ${mine}.`,
  ];
  return `${task} Rules for this job: ${rules.map((r, i) => `(${i + 1}) ${r}`).join(" ")}`.replace(/\s+/g, " ").trim();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** COMPAT's dated folder name: the kit title, an en dash, then "Jan 15 2026, 9.05 AM". */
export function datedName(title: string, ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${title} – ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}, ${h}.${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

/** Done means the marker was written at or after this run started. */
export const roleDone = (check: RunCheck, roleId: string) => (check.files[roleId]?.[MARKER] ?? -1) >= check.record.started;

/** A session as the strip sees it. */
export type SeatInfo = { key: number; running?: boolean; needs?: boolean; ai?: string | null };
export type RowState = "not-ready" | "waiting" | "working" | "done" | "left" | "needs" | "stopped";
export type RoleRow = { state: RowState; text: string; key: number | null };

/** SKILL-010: one role's plain status. `sentAt` is when a waiting role got its prompt. */
export function roleRow(kit: Kit, role: KitRole, check: RunCheck, seat: SeatInfo | null, sentAt: number | null, now: number): RoleRow {
  const key = seat?.key ?? null;
  if (roleDone(check, role.id)) return { state: "done", text: "Done", key };
  if (!seat) {
    const old = role.delivers.some((f) => (check.files[role.id]?.[f] ?? Infinity) < check.record.started);
    return old ? { state: "left", text: "Left from the last run", key } : { state: "not-ready", text: "Not ready yet", key };
  }
  // ponytail: needs you and stopped come from what the window knows (bell / program ended); the
  // sign-in, review-hooks and usage-limit labels arrive with the status hooks (T-025) and SKILL-011.
  if (seat.needs) return { state: "needs", text: "Needs you", key };
  if (seat.running === false) return { state: "stopped", text: "Stopped: the AI ended before it finished", key };
  const upstream = role.waitsFor ? kit.roles.find((r) => r.id === role.waitsFor) : undefined;
  if (upstream && sentAt === null) return { state: "waiting", text: `Waiting on ${upstream.title}`, key };
  const mins = Math.floor((now - (sentAt ?? check.record.started)) / 60000);
  return { state: "working", text: mins < 1 ? "Working" : `Working, ${mins} min`, key };
}

/** SKILL-010: sessions tied to roles by the saved mapping, else by AI and launch order, never
 * using one session twice. `panes` are the workspace's sessions in launch order. */
export function matchSeats(record: RunRecord, saved: (number | null)[] | null, panes: { key: number; ai: string | null }[]): (number | null)[] {
  const live = new Set(panes.map((p) => p.key));
  if (saved && saved.length === record.roles.length && saved.every((k) => k !== null && live.has(k))) return saved;
  const used = new Set<number>();
  return record.roles.map((r) => {
    const p = panes.find((x) => x.ai === r.ai && !used.has(x.key));
    if (!p) return null;
    used.add(p.key);
    return p.key;
  });
}

/** SKILL-012: how a result previews: HTML in the browser pane, Markdown rendered, the rest in a
 * read-only editor tab. */
export const previewKind = (file: string): "browser" | "preview" | "editor" => (/\.html?$/i.test(file) ? "browser" : /\.(md|markdown)$/i.test(file) ? "preview" : "editor");

/** SKILL-011: a stopped role can move to every other connected AI. */
export const moveTargets = (current: string | null, connected: Vendor[]): Vendor[] => connected.filter((v) => v !== current);
