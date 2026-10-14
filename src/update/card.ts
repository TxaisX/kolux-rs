// APP-025 / APP-026 / APP-027 / APP-028 / APP-029 / APP-030 / APP-031: what the update card and the ready pop-up show. A pure
// reducer (card.test.ts); UpdateCenter.tsx wires it to the timetable and the back end.

import type { Quiet } from "./schedule";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string[];
  date?: string | null;
}

export type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate"; note?: string }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; received: number; total: number | null }
  | { kind: "ready"; info: UpdateInfo }
  | { kind: "updated"; version: string }
  /** APP-030: a security stop; the update was refused and there is no way to install it anyway. */
  | { kind: "blocked"; info: UpdateInfo; message: string; remembered: boolean }
  | { kind: "error"; message: string; next: string; info: UpdateInfo | null; retry: "check" | "download" | "restart"; installer?: boolean };

/** APP-028: what the last install attempt means at this launch (update_status). */
export type LastLaunch = { kind: "updated"; version: string; notes: string[] } | { kind: "failed"; version: string; from: string };

/** Where the installer can be fetched by hand. */
export const RELEASES_PAGE = "https://github.com/TxaisX/kolux-rs-releases/releases/latest";

export interface CardState {
  phase: Phase;
  /** The card is on screen (expanded or collapsed). */
  shown: boolean;
  collapsed: boolean;
  /** The current flow started with the user's own click. */
  requested: boolean;
  /** Release notes of the offered version; cleared when a new check begins. */
  notes: string[];
  dismissed: string | null;
  /** The reassurance tip is gone for good (persisted). */
  tipDone: boolean;
  /** The tip shows during this flow (decided when the update was first offered). */
  tipNow: boolean;
  popup: string | null;
  /** Versions whose pop-up was already shown this launch. */
  popupSeen: string[];
}

export type Action =
  | { type: "checkStart"; requested: boolean }
  | { type: "checkDone"; requested: boolean; found: UpdateInfo | null; quiet?: Quiet }
  | { type: "checkFailed"; requested: boolean; message: string; offline: boolean; next?: string; local?: boolean }
  | { type: "downloadStart"; info: UpdateInfo }
  | { type: "progress"; version: string; received: number; total: number | null }
  | { type: "ready"; info: UpdateInfo }
  | { type: "downloadFailed"; info: UpdateInfo; message: string; offline: boolean }
  | { type: "notReady" }
  | { type: "installFailed"; info: UpdateInfo | null; message: string }
  | { type: "lastLaunch"; launch: LastLaunch; local?: boolean }
  | { type: "faded" }
  | { type: "collapse" }
  | { type: "expand" }
  | { type: "dismiss" }
  | { type: "show" }
  | { type: "tipDismiss" }
  | { type: "popupClose" }
  | { type: "hydrate"; dismissed: string | null; tipDone: boolean };

export function initialCard(dismissed: string | null, tipDone: boolean): CardState {
  return { phase: { kind: "idle" }, shown: false, collapsed: false, requested: false, notes: [], dismissed, tipDone, tipNow: false, popup: null, popupSeen: [] };
}

export function nextStep(offline: boolean, stage: "check" | "download", local = false): string {
  if (offline) return "You look offline. Connect to the internet, then press Try again.";
  return stage === "check"
    ? local
      ? "Press Try again in a minute." // APP-031: a local build is never sent to the download page
      : "Press Try again in a minute. If it keeps failing, get the newest version from the releases page."
    : "Press Try again to download it once more; your work is not affected.";
}

/** APP-031: a calm line for a check the user asked for that found nothing to install. */
export function quietNote(q: Quiet): string {
  if (q === "halfPublished") return "A new version is being published right now. Kolux RS will look again in a few minutes.";
  if (q === "refused") return "The newest installer was stopped earlier because it did not come from this copy's publisher, so it is not offered again.";
  if (q === "noPlatform") return "The newest release has no download for this computer yet. Kolux RS will keep looking.";
  return "The update server has nothing newer to offer right now.";
}

/** APP-030: the back end's security-stop text, or null for any other failure. A stop for the
 *  publisher is remembered (that version is never offered again); a download whose signature could
 *  not be read at all is stopped this time only. */
export const SECURITY_STOP = "security-stop: ";
export const SECURITY_STOP_ONCE = "security-stop-once: ";
export function securityStop(raw: string): { message: string; remembered: boolean } | null {
  for (const [mark, remembered] of [[SECURITY_STOP, true], [SECURITY_STOP_ONCE, false]] as const) {
    const at = raw.indexOf(mark);
    if (at >= 0) return { message: raw.slice(at + mark.length).trim() || "The update was refused.", remembered };
  }
  return null;
}

/** The updater's own words, turned into a sentence a user can act on. */
export function plainError(raw: string): string {
  if (/signature/i.test(raw)) return "The download's signature did not match, so it was thrown away.";
  if (/sending request|connect|dns|resolve|network|timed out|timeout|no answer/i.test(raw)) return "Kolux RS could not reach the update server.";
  if (/status code|404|not found/i.test(raw)) return "The update server did not have the release.";
  if (/decoding|deserializ|invalid type|expected value|json/i.test(raw)) return "The update server sent an answer Kolux RS could not read.";
  return raw;
}

export function versionOf(p: Phase): string | null {
  return "info" in p && p.info ? p.info.version : null;
}

// A change of phase reopens the card when it belongs to the user's own check, unless the user
// dismissed this very version.
function reopen(s: CardState, phase: Phase): CardState {
  const v = versionOf(phase);
  const show = s.requested && !(v !== null && v === s.dismissed);
  return { ...s, phase, shown: s.shown || show, collapsed: show ? false : s.collapsed };
}

export function cardReducer(s: CardState, a: Action): CardState {
  switch (a.type) {
    case "checkStart": {
      // A request while a quiet check runs takes that check over; either way the notes reset.
      const base = { ...s, notes: [] as string[] };
      if (!a.requested) return s.phase.kind === "ready" ? s : { ...base, phase: s.shown ? { kind: "checking" } : s.phase };
      // A ready update stays on show (with Restart to update) while the check runs.
      if (s.phase.kind === "ready") return { ...s, requested: true, shown: true, collapsed: false, tipNow: false };
      return { ...base, requested: true, shown: true, collapsed: false, tipNow: false, phase: { kind: "checking" } };
    }
    case "checkDone": {
      const requested = s.requested || a.requested;
      if (!a.found) {
        if (!requested) return { ...s, requested: false };
        // APP-031: an update already downloaded stays ready while the feed is being republished.
        if (s.phase.kind === "ready") return { ...s, requested, shown: true, collapsed: false };
        return { ...s, requested, shown: true, collapsed: false, phase: a.quiet ? { kind: "upToDate", note: quietNote(a.quiet) } : { kind: "upToDate" } };
      }
      const info = a.found;
      // A ready download of the same version stays ready.
      if (s.phase.kind === "ready" && s.phase.info.version === info.version) {
        return requested ? { ...s, requested, shown: true, collapsed: false, notes: info.notes } : s;
      }
      const tipNow = s.tipNow || !s.tipDone;
      const next: CardState = { ...s, requested, notes: info.notes, tipNow };
      return requested ? { ...next, shown: true, collapsed: false, phase: { kind: "available", info } } : { ...next, phase: { kind: "available", info } };
    }
    case "checkFailed": {
      if (!(s.requested || a.requested)) return s;
      return {
        ...s,
        requested: true,
        shown: true,
        collapsed: false,
        notes: [],
        phase: { kind: "error", message: a.next ? a.message : plainError(a.message), next: a.next ?? nextStep(a.offline, "check", a.local), info: null, retry: "check" },
      };
    }
    case "downloadStart": {
      // Once a download starts the tip never comes back on later updates.
      return reopen({ ...s, tipDone: true, notes: s.notes.length ? s.notes : a.info.notes }, { kind: "downloading", info: a.info, received: 0, total: null });
    }
    case "progress": {
      if (s.phase.kind !== "downloading" || s.phase.info.version !== a.version) return s;
      return { ...s, phase: { ...s.phase, received: a.received, total: a.total } };
    }
    case "ready": {
      const v = a.info.version;
      const next = reopen({ ...s, notes: s.notes.length ? s.notes : a.info.notes }, { kind: "ready", info: a.info });
      // The pop-up shows once per version per launch, and stays silent while the card shows this update.
      const cardOnIt = next.shown && versionOf(next.phase) === v;
      if (cardOnIt || s.popupSeen.includes(v)) return next;
      return { ...next, popup: v, popupSeen: [...s.popupSeen, v] };
    }
    case "downloadFailed": {
      // APP-030: a security stop always shows, with no install option and no retry.
      const stop = securityStop(a.message);
      if (stop !== null) return { ...s, popup: null, requested: true, shown: true, collapsed: false, phase: { kind: "blocked", info: a.info, message: stop.message, remembered: stop.remembered } };
      // Download errors bring the card up even after a quiet check.
      return {
        ...s,
        requested: true,
        shown: true,
        collapsed: false,
        phase: { kind: "error", message: plainError(a.message), next: nextStep(a.offline, "download"), info: a.info, retry: "download" },
      };
    }
    case "installFailed":
      // APP-029: the installer could not start; the app stays open, the update stays ready.
      return {
        ...s,
        popup: null,
        requested: true,
        shown: true,
        collapsed: false,
        phase: { kind: "error", message: a.message, next: "Kolux RS stays open and your work is untouched. Fix the cause, then press Try again.", info: a.info, retry: "restart" },
      };
    case "lastLaunch": {
      // APP-028: shown once, at the launch after an install attempt.
      const l = a.launch;
      if (l.kind === "updated") return { ...s, shown: true, collapsed: false, notes: l.notes, phase: { kind: "updated", version: l.version } };
      return {
        ...s,
        shown: true,
        collapsed: false,
        notes: [],
        phase: {
          kind: "error",
          message: "The update did not install. Another program may have been using Kolux RS's files, or the installer was stopped.",
          next: `You are still on ${l.from}. Press Try again to fetch it once more${a.local ? "." : ", or download the installer."}`,
          info: { version: l.version, currentVersion: l.from, notes: [] },
          retry: "check",
          installer: !a.local,
        },
      };
    }
    case "notReady":
      return { ...s, popup: null, phase: s.phase.kind === "ready" ? { kind: "idle" } : s.phase };
    case "faded":
      return s.phase.kind === "upToDate" || s.phase.kind === "updated" ? { ...s, shown: false, requested: false, phase: { kind: "idle" } } : s;
    case "collapse":
      return s.shown ? { ...s, collapsed: true } : s;
    case "expand":
      return { ...s, collapsed: false };
    case "dismiss": {
      const v = versionOf(s.phase);
      const keepFlow = s.phase.kind === "ready" || s.phase.kind === "downloading";
      return {
        ...s,
        shown: false,
        collapsed: false,
        requested: false,
        dismissed: v ?? s.dismissed,
        phase: keepFlow ? s.phase : s.phase.kind === "available" ? s.phase : { kind: "idle" },
      };
    }
    case "show":
      // VIEW-100: the status bar item brings the card back, expanded, while there is an update to show.
      return s.phase.kind === "idle" ? s : { ...s, shown: true, collapsed: false };
    case "tipDismiss":
      return { ...s, tipDone: true, tipNow: false };
    case "popupClose":
      return { ...s, popup: null };
    case "hydrate":
      return { ...s, dismissed: a.dismissed, tipDone: a.tipDone };
  }
}

/** The tip shows while an update is offered or downloading, the first time only. */
export function tipVisible(s: CardState): boolean {
  return s.tipNow && s.shown && !s.collapsed && (s.phase.kind === "available" || s.phase.kind === "downloading");
}

/** The words on the card's main button. A security stop closes with "Close" (council FIX-2 AFTER 5):
 *  "OK" there could read as agreeing to the stopped update. */
export function actionLabel(p: Phase): string | null {
  const action = mainAction(p);
  if (action === "restart") return p.kind === "error" ? "Try again" : "Restart to update";
  if (action === "download") return "Download";
  if (action === "retryCheck" || action === "retryDownload") return "Try again";
  if (action === "close") return p.kind === "blocked" ? "Close" : "OK";
  return null;
}

/** The card's main action, run by Enter. */
export function mainAction(p: Phase): "close" | "download" | "restart" | "retryCheck" | "retryDownload" | null {
  switch (p.kind) {
    case "upToDate":
    case "updated":
    case "blocked":
      return "close";
    case "available":
      return "download";
    case "ready":
      return "restart";
    case "error":
      return p.retry === "check" ? "retryCheck" : p.retry === "restart" ? "restart" : "retryDownload";
    default:
      return null;
  }
}

export interface BarItem {
  tone: "info" | "ready" | "error";
  text: string;
  title: string;
}

/** VIEW-100: the status bar's update item; nothing while idle, checking or up to date. */
export function barItem(p: Phase): BarItem | null {
  const title = "Click to show the update card";
  switch (p.kind) {
    case "available":
      return { tone: "info", text: `Update ${p.info.version}`, title: `Kolux RS ${p.info.version} is available. ${title}` };
    case "downloading": {
      const pct = p.total ? ` · ${Math.min(100, Math.floor((p.received / p.total) * 100))}%` : "";
      return { tone: "info", text: `Downloading ${p.info.version}${pct}`, title: `Downloading Kolux RS ${p.info.version}. ${title}` };
    }
    case "ready":
      return { tone: "ready", text: "Restart to update", title: `Kolux RS ${p.info.version} is ready to install. ${title}` };
    case "error":
      return { tone: "error", text: "Update failed", title: `${p.message} ${title}` };
    case "blocked":
      return { tone: "error", text: "Update stopped", title: `Kolux RS ${p.info.version} was refused: ${p.message} ${title}` };
    default:
      return null;
  }
}
