// T-074 (BROW-008, BROW-009): what a browser tab knows about the health of its page, as a pure
// state machine. The engine (wry over WebView2) reports only that a load started and finished:
// not whether it failed, nor that the process behind the page died. So the pane probes the page
// about four times a second while it is on screen (`browser_probe` runs `location.href` in the
// page): the engine's own error page answers with its chrome-error:// address, a live page with
// its own, and a dead page not at all. This module turns those answers into the overlay the user
// sees and the one automatic reload a crashed page gets; the timing lives in BrowserPane.

/** What the back end's probe of the page came back with. */
export type Probe = "page" | "error-page" | "no-answer";
export type Phase = "blank" | "loading" | "ok" | "recovering" | "failed" | "crashed";
/** `recovery`: the load in flight is the automatic reload of a dead page, so what it lands on is
 *  judged as crash recovery (BROW-009), not as a network failure. */
export type Health = { phase: Phase; url: string; misses: number; recoveries: number; recovery: boolean };
export type Event =
  | { t: "started"; url: string }
  | { t: "finished"; url: string }
  | { t: "probe"; answer: Probe }
  /** The user pressed Retry on the overlay, or any other reload trigger while it shows. */
  | { t: "retry" }
  /** The user typed an address: a new page gets its own recovery allowance. */
  | { t: "navigate" };
/** `reload`: the pane reloads the page. `overlay`: a recovery overlay goes up (see `overlayOf`). */
export type Action = "none" | "reload" | "overlay";

/** Unanswered probes in a row before a page counts as dead (BROW-009): a page running a long
 *  script misses one or two; three at a quarter-second apart is most of a second of silence. */
export const DEAD_AFTER = 3;
/** Automatic reloads a page gets before the user has to act (BROW-009: limited, never a loop). */
export const MAX_RECOVERIES = 1;
/** How often the page is probed while on screen (BROW-008: about four times a second). */
export const PROBE_MS = 250;

export const fresh = (): Health => ({ phase: "blank", url: "", misses: 0, recoveries: 0, recovery: false });

export function step(h: Health, e: Event): [Health, Action] {
  switch (e.t) {
    case "started":
      return [{ ...h, phase: "loading", url: e.url, misses: 0, recovery: h.phase === "recovering" }, "none"];
    case "finished":
      // The probe decides what finished: a page, or the engine's error page. A reload the pane
      // ordered for a dead page stays "recovering" until the probe hears the page again.
      if (h.phase === "loading") return [{ ...h, phase: h.recovery ? "recovering" : "ok", url: e.url, misses: 0, recovery: false }, "none"];
      return [h, "none"];
    case "retry":
      return [{ ...h, misses: 0, recoveries: 0, recovery: false }, "reload"];
    case "navigate":
      return [{ ...h, misses: 0, recoveries: 0, recovery: false }, "none"];
    case "probe":
      return probed(h, e.answer);
  }
}

function probed(h: Health, answer: Probe): [Health, Action] {
  // While the overlay is up the page is hidden under it; while a load is in flight the page is
  // waited for (BROW-009), and a blank tab has nothing to probe.
  if (h.phase === "failed" || h.phase === "crashed" || h.phase === "loading" || h.phase === "blank") return [h, "none"];
  switch (answer) {
    case "page":
      return [{ ...h, phase: "ok", misses: 0 }, "none"];
    case "error-page":
      // BROW-008: the engine's error page is covered by the overlay; coming out of crash recovery
      // it is the crash that failed, so the network wording stays out.
      return [{ ...h, phase: h.phase === "recovering" ? "crashed" : "failed", misses: 0 }, "overlay"];
    case "no-answer": {
      const misses = h.misses + 1;
      if (misses < DEAD_AFTER) return [{ ...h, misses }, "none"];
      if (h.phase === "ok" && h.recoveries < MAX_RECOVERIES) return [{ ...h, phase: "recovering", misses: 0, recoveries: h.recoveries + 1 }, "reload"];
      return [{ ...h, phase: "crashed", misses: 0 }, "overlay"];
    }
  }
}

export type Overlay = { kind: "failed" | "crashed"; url: string } | null;
export const overlayOf = (h: Health): Overlay => (h.phase === "failed" || h.phase === "crashed" ? { kind: h.phase, url: h.url } : null);

/** The back end's look at why an address failed (`browser_diagnose`). `https` is the same
 *  address over https when the switch makes sense (BROW-008: a failed http address, nothing but
 *  the scheme changed), `local` says the address is this computer's. */
export type Kind = "unknown-host" | "refused" | "timeout" | "unreachable" | "certificate" | "unknown";
export type Diagnosis = { kind: Kind; local: boolean; https: string | null };

export type OverlayModel = {
  title: string;
  text: string;
  /** Local-server advice; only for this computer's addresses, never for public sites. */
  advice: string | null;
  switchHttps: string | null;
  /** Hidden while the address cannot be reached from this computer (the system browser would fail
   *  the same way) and until the diagnosis is in. */
  openExternally: boolean;
};

const where = (url: string) => {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
};

/** The overlay's words and buttons (BROW-008). `diag` is null until `browser_diagnose` answers. */
export function overlayModel(overlay: NonNullable<Overlay>, diag: Diagnosis | null): OverlayModel {
  const host = where(overlay.url);
  if (overlay.kind === "crashed") {
    // BROW-009: the page's process died (or stopped answering) and the one automatic reload did not
    // bring it back; no network troubleshooting here.
    return { title: "This page stopped responding", text: "Kolux reloaded it once and it did not come back.", advice: null, switchHttps: null, openExternally: /^https?:/i.test(overlay.url) };
  }
  if (!diag) return { title: "This page could not load", text: `${host} did not give Kolux a page.`, advice: null, switchHttps: null, openExternally: false };
  const reachable = diag.kind === "certificate" || diag.kind === "unknown";
  const switchHttps = diag.kind === "unknown-host" ? null : diag.https;
  const local = diag.local ? "If this is your own server, start it, then press Retry." : null;
  const text = {
    "unknown-host": `Kolux could not find ${host}.`,
    refused: diag.local ? `Nothing is listening on ${host}.` : `${host} refused the connection.`,
    timeout: `${host} did not answer in time.`,
    unreachable: `${host} cannot be reached from this computer.`,
    certificate: `${host} showed a certificate Kolux does not trust, so the page stays blocked. Certificate checking stays strict.`,
    unknown: `${host} did not give Kolux a page.`,
  }[diag.kind];
  return { title: "This page could not load", text, advice: diag.kind === "certificate" ? null : local, switchHttps, openExternally: reachable };
}
