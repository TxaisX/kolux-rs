// T-549 (OD-15, DT-C37): a GitHub Projects roadmap view drawn as a timeline: each item is a bar from
// its start to its end, read from the project's date or iteration fields. GitHub does not say which
// fields a roadmap view uses, so Kolux picks them (date fields named like a start or an end first,
// else an iteration, else the first date fields; FIX-2 council A1) and the user may change them;
// the choice is remembered per project.
import type { ProjectField, ProjectItem } from "./projects";

const DAY = 86_400_000;

/** Days since 1970-01-01 (UTC) for a YYYY-MM-DD date; null for anything else. */
export function dayNumber(d: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(t);
  return back.getUTCDate() === Number(m[3]) && back.getUTCMonth() === Number(m[2]) - 1 ? Math.round(t / DAY) : null;
}

export const dayString = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

export const timelineFields = (fields: ProjectField[]) => fields.filter((f) => f.kind === "date" || f.kind === "iteration");

/** The fields a timeline opens with: a saved choice that still exists, else a date field named like
 * a start and one named like an end (either may stand alone: an item with one date is one day
 * long), else an iteration field for both ends, else the first two date fields. */
export function defaultTimeline(fields: ProjectField[], saved?: unknown): { start: string; end: string } | null {
  const usable = timelineFields(fields);
  const has = (id: unknown) => typeof id === "string" && usable.some((f) => f.id === id);
  const s = saved as { start?: unknown; end?: unknown } | undefined;
  if (s && has(s.start) && has(s.end)) return { start: s.start as string, end: s.end as string };
  const it = usable.find((f) => f.kind === "iteration");
  const dates = usable.filter((f) => f.kind === "date");
  const start = dates.find((f) => /start|begin|from/i.test(f.name));
  const end = dates.find((f) => f !== start && /end|due|target|finish|until|deadline/i.test(f.name));
  if (start || end) return { start: (start ?? end)!.id, end: (end ?? start)!.id };
  if (it) return { start: it.id, end: it.id };
  return dates[0] ? { start: dates[0].id, end: (dates[1] ?? dates[0]).id } : null;
}

/** One item's span in days (inclusive), or null when it has neither end. An iteration ends on its
 * last day; an end before the start is drawn as the start's single day. */
export function itemSpan(item: ProjectItem, fields: ProjectField[], pick: { start: string; end: string }): { from: number; to: number } | null {
  if (item.kind === "restricted") return null;
  const edge = (id: string, which: "start" | "end"): number | null => {
    const f = fields.find((x) => x.id === id);
    const c = item.values[id];
    if (!f || !c) return null;
    const d = dayNumber(c.start || c.text);
    if (d === null) return null;
    return f.kind === "iteration" && which === "end" ? d + Math.max(1, c.days) - 1 : d;
  };
  const a = edge(pick.start, "start");
  const b = edge(pick.end, "end");
  if (a === null && b === null) return null;
  const from = a ?? b!;
  const to = b ?? (a !== null ? (edge(pick.start, "end") ?? from) : from);
  return { from, to: Math.max(from, to) };
}

/** The days the timeline shows: every span and today, a week either side; a month around today
 * when nothing has dates. */
export function timelineRange(spans: { from: number; to: number }[], today: number): { from: number; to: number } {
  if (spans.length === 0) return { from: today - 30, to: today + 30 };
  const from = Math.min(today, ...spans.map((s) => s.from));
  const to = Math.max(today, ...spans.map((s) => s.to));
  return { from: from - 7, to: to + 7 };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The first day of each month inside the range, labelled with the year at the first tick and in
 * January, else the month alone. */
export function monthTicks(range: { from: number; to: number }): { day: number; label: string }[] {
  const out: { day: number; label: string }[] = [];
  const d = new Date(range.from * DAY);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + (d.getUTCDate() === 1 ? 0 : 1);
  if (m > 11) {
    m = 0;
    y += 1;
  }
  for (;;) {
    const day = Math.round(Date.UTC(y, m, 1) / DAY);
    if (day > range.to) break;
    out.push({ day, label: out.length === 0 || m === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m] });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** Where a span sits, as percentages of the range (the bar is at least one day wide). */
export function barPlace(span: { from: number; to: number }, range: { from: number; to: number }): { left: number; width: number } {
  const days = range.to - range.from + 1;
  return { left: ((span.from - range.from) / days) * 100, width: ((span.to - span.from + 1) / days) * 100 };
}

export const todayNumber = (now = new Date()) => Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY);
