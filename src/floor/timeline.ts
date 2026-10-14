// VIEW-013: the Floor timeline's rules as pure functions, so they are tested without a window.
// One lane per agent pane; its state changes (from activity_timeline) become coloured segments
// clamped to the chosen range.

export type Mark = { at: number; state: string };
export type Track = { pane: number; marks: Mark[]; ended: number | null; terminal: number | null; live: boolean };
export type Kind = "working" | "needs" | "idle" | "unverifiable";
export type Segment = { kind: Kind; from: number; to: number };
export type Range = "15m" | "60m" | "today";

export const RANGES: { id: Range; label: string }[] = [
  { id: "15m", label: "15 minutes" },
  { id: "60m", label: "60 minutes" },
  { id: "today", label: "Today" },
];

/** Where the axis starts: today is local midnight, not 24 hours back. */
export function rangeStart(range: Range, now: number): number {
  if (range === "15m") return now - 15 * 60_000;
  if (range === "60m") return now - 60 * 60_000;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Blocked and waiting both read needs-you. */
export function kindOf(state: string): Kind {
  if (state === "working") return "working";
  if (state === "permission" || state === "waiting" || state === "blocked" || state === "needs-input") return "needs";
  return "idle";
}

/** A lane's segments within [from, to]. A lane whose terminal is gone cannot vouch for its quiet
 * stretches, so they read unverifiable instead of idle. Nothing is drawn after the pane closed. */
export function segments(t: Track, from: number, to: number): Segment[] {
  const out: Segment[] = [];
  const end = Math.min(to, t.ended ?? to);
  t.marks.forEach((m, i) => {
    let kind = kindOf(m.state);
    if (kind === "idle" && !t.live) kind = "unverifiable";
    const a = Math.max(from, m.at);
    const b = Math.min(end, t.marks[i + 1]?.at ?? end);
    if (b <= a) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.to === a) last.to = b;
    else out.push({ kind, from: a, to: b });
  });
  return out;
}

/** Six evenly spaced ticks along the axis, both ends included. */
export const ticks = (from: number, to: number) => Array.from({ length: 6 }, (_, i) => from + ((to - from) * i) / 5);

/** Lanes in pane order; a lane with nothing inside the range is left off. */
export function lanes(tracks: Track[], from: number, to: number) {
  return [...tracks]
    .sort((a, b) => a.pane - b.pane)
    .map((t) => ({ track: t, segs: segments(t, from, to) }))
    .filter((l) => l.segs.length > 0);
}
