// VIEW-090 (T-276): what the session list tells the user when something blocked or limited the scan.
// The back end counts what it could not do (session_scan.rs); this turns that count into a few short
// notices. A skipped transcript is a fact worth a line, never an error: the sessions that could be
// read are listed beside it.
import type { Session } from "./model";

/** What one scan could not do. */
export type ScanReport = { skipped: number; cutShort: boolean; unreadable: string[]; noSources: boolean };
export type Listing = { sessions: Session[]; report: ScanReport };

export const NO_REPORT: ScanReport = { skipped: 0, cutShort: false, unreadable: [], noSources: false };
/** At most this many notices are shown at once. */
export const MAX_NOTICES = 3;

export type Notice = { id: string; text: string };

/** The back end's answer in either shape (a plain list from an older cache is a list with no report). */
export function asListing(raw: unknown): Listing {
  if (Array.isArray(raw)) return { sessions: raw as Session[], report: NO_REPORT };
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const r = typeof o.report === "object" && o.report !== null ? (o.report as Record<string, unknown>) : {};
  return {
    sessions: Array.isArray(o.sessions) ? (o.sessions as Session[]) : [],
    report: {
      skipped: typeof r.skipped === "number" && r.skipped > 0 ? Math.floor(r.skipped) : 0,
      cutShort: r.cutShort === true,
      unreadable: Array.isArray(r.unreadable) ? r.unreadable.filter((u): u is string => typeof u === "string" && u.trim() !== "") : [],
      noSources: r.noSources === true,
    },
  };
}

/** The notices for a scan that listed `listed` sessions: de-duplicated and capped. */
export function notices(report: ScanReport, listed: number): Notice[] {
  const out: Notice[] = [];
  const add = (id: string, text: string) => {
    if (!out.some((n) => n.id === id || n.text === text)) out.push({ id, text });
  };
  if (listed === 0 && report.noSources) add("none", "No agent has left a session folder on this computer yet, so there is nothing to list.");
  if (report.skipped > 0) add("skipped", `${report.skipped} transcript${report.skipped === 1 ? " was" : "s were"} unreadable and skipped.`);
  if (report.cutShort) add("cut", "The scan took too long and was cut short. Refresh to look again.");
  for (const what of report.unreadable) add(`unreadable:${what}`, `Could not read ${what}.`);
  return out.slice(0, MAX_NOTICES);
}
