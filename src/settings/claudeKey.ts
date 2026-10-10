// What the Claude card on Settings > AI connections says about the 1-year key (ACCT-004). The
// back end (src-tauri/src/claude_key.rs) runs the hidden setup and keeps the key sealed; the
// window only ever sees these figures, never the key itself.
import { fixFor, type Attention } from "./Attention";

export type KeyStatus = {
  connected: boolean;
  createdAt: number | null;
  expiresAt: number | null;
  daysLeft: number | null;
  renewDue: boolean;
  expired: boolean;
  settingUp: boolean;
  inBrowser: boolean;
  attention: Attention | null;
};

export type KeyAction = "connect" | "renew" | "cancel" | "disconnect";

export type KeyCard = {
  state: "reading" | "disconnected" | "connecting" | "connected" | "warning" | "expired" | "attention";
  headline: string;
  detail: string;
  /** A failed renewal or setup, or a usage limit, shown under the card's own text (ACCT-013). */
  attention: Attention | null;
  actions: KeyAction[];
};

/** "October 2027": the month the key must be renewed in. */
export function monthYear(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function keyCard(s: KeyStatus | null): KeyCard {
  if (!s) return { state: "reading", headline: "Reading…", detail: "", attention: null, actions: [] };
  if (s.settingUp) {
    return {
      state: "connecting",
      headline: s.inBrowser ? "Finish in the browser" : "Starting Claude's key setup…",
      detail: s.inBrowser ? "Approve the request on the Claude page that opened. Kolux keeps the key when you are done." : "Claude Code is preparing the sign-in page.",
      attention: null,
      actions: ["cancel"],
    };
  }
  if (s.connected) {
    const month = s.expiresAt !== null ? monthYear(s.expiresAt) : null;
    if (s.expired) {
      return { state: "expired", headline: "Connected · 1-year key ran out", detail: `The key ran out${month ? ` in ${month}` : ""}. Renew it to keep Claude connected.`, attention: s.attention, actions: ["renew", "disconnect"] };
    }
    if (s.renewDue) {
      const days = s.daysLeft === 1 ? "1 day" : `${s.daysLeft ?? 0} days`;
      return { state: "warning", headline: "Connected · 1-year key", detail: `The key runs out in ${days}${month ? ` (${month})` : ""}. Renew it before then.`, attention: s.attention, actions: ["renew", "disconnect"] };
    }
    return {
      state: "connected",
      headline: "Connected · 1-year key",
      detail: month ? `Renew in ${month}. Nothing to paste or sign in again before then.` : "Nothing to paste or sign in again for a year.",
      attention: s.attention,
      actions: ["disconnect"],
    };
  }
  // A fix replaces Connect; a reason with no fix keeps it, since connecting is still the way in.
  if (s.attention && s.attention.reason !== "usage-limit") return { state: "attention", headline: "Needs attention", detail: "", attention: s.attention, actions: fixFor(s.attention, "claude-key") ? [] : ["connect"] };
  return {
    state: "disconnected",
    headline: "Connect with a key that lasts a year",
    detail: "Connect opens Claude's sign-in page in your browser once and keeps a key that lasts a year.",
    attention: s.attention,
    actions: ["connect"],
  };
}

/** SET-030: Claude Code's own sign-in, reported only when new Claude panes run on it. */
export type OwnSignIn = { state: "signed-in" | "signed-out" | "not-installed" | "unknown"; email: string | null };

export function ownSignInLine(o: OwnSignIn | null): { text: string; warn: boolean } | null {
  if (!o || o.state === "unknown") return null;
  if (o.state === "signed-in") return { text: `New Claude panes use Claude Code's own sign-in on this PC${o.email ? ` (${o.email})` : ""}.`, warn: false };
  if (o.state === "signed-out") return { text: "Claude Code is not signed in on this PC, so new Claude panes will ask you to sign in. Connect, or use your Claude account.", warn: true };
  return { text: "Claude Code is not installed on this PC.", warn: true };
}

/** USAGE-007's switch: off unless the user turned it on. */
export const RESUME_FIELD = "claudeResumeAfterLimit";
export const resumeOn = (settings: Record<string, unknown>): boolean => settings[RESUME_FIELD] === true;

export const actionLabel: Record<KeyAction, string> = { connect: "Connect", renew: "Renew", cancel: "Cancel", disconnect: "Disconnect" };
