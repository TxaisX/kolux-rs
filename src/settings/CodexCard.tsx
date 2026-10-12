// The Codex card on Settings > AI connections (ACCT-007): Connect signs a ChatGPT account in
// through the browser, "Sign in with a code" shows a link and a one-time code to enter on any
// device. Each account Kolux adds runs in a private Codex home; the user's own Codex folder is
// never touched. A System default row reports Codex's own login as it is, re-read whenever Kolux
// gets focus (ACCT-020); managed rows can be picked, re-signed or removed (ACCT-019, T-138). The
// full Connect-card states are T-092; telling a personal from a business workspace is T-138-b.
import { useCallback, useEffect, useState } from "react";
import { AccountRow, signedInAt } from "./AccountRow";
import { invoke } from "@tauri-apps/api/core";
import { AttentionNote, fixFor, openInstallPage, type Attention } from "./Attention";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";

export type CodexAccount = { id: string; email: string | null; home: string; lastSignIn: number; signInError: boolean };
export type CodexView = {
  accounts: CodexAccount[];
  active: string | null;
  systemDefault: "chatgpt" | "api-key" | "custom-provider" | "signed-out";
  signingIn: "browser" | "device" | null;
  inBrowser: boolean;
  deviceLink: string | null;
  deviceCode: string | null;
  attention: Attention | null;
  /** Accounts whose home's config.toml no longer agrees with what Kolux wrote (SET-030). */
  drifted: string[];
  /** ACCT-019: accounts whose sign-in file has been gone longer than the grace period. */
  missing: string[];
};
export type CodexAction = { kind: "connect" } | { kind: "code" } | { kind: "cancel" } | { kind: "activate"; id: string | null } | { kind: "ask-remove"; id: string } | { kind: "remove"; id: string } | { kind: "keep" } | { kind: "again"; id: string } | { kind: "install" };

const systemLabel: Record<CodexView["systemDefault"], string> = {
  chatgpt: "a ChatGPT sign-in",
  "api-key": "an API key",
  "custom-provider": "an API key with a custom provider",
  "signed-out": "",
};
const systemRow: Record<CodexView["systemDefault"], string> = {
  chatgpt: "Signed in with ChatGPT",
  "api-key": "Running on an API key",
  "custom-provider": "Running on an API key with a custom provider",
  "signed-out": "Signed out",
};

/** SET-030: what is wrong with one account, if anything. */
export function codexTrouble(v: CodexView, a: CodexAccount): string | null {
  if (v.missing.includes(a.id)) return "Needs sign-in";
  if (a.signInError) return "Needs re-auth";
  if (v.drifted.includes(a.id)) return "Settings changed";
  return null;
}

export function codexHeadline(v: CodexView): string {
  if (v.signingIn === "device") return v.deviceCode ? "Enter the code on any device" : "Asking for a sign-in code…";
  if (v.signingIn) return v.inBrowser ? "Finish signing in in the browser" : "Starting Codex's sign-in…";
  const active = v.accounts.find((a) => a.id === v.active);
  if (active) return `Connected · ${active.email ?? "ChatGPT account"}`;
  if (v.systemDefault !== "signed-out") return `Connected · Codex's own login (${systemLabel[v.systemDefault]})`;
  return "Connect with your ChatGPT plan";
}

export function CodexCardView({ view, error, confirming = null, onAction }: { view: CodexView | null; error?: string | null; confirming?: string | null; onAction: (a: CodexAction) => void }) {
  if (!view) return null;
  const busy = view.signingIn !== null;
  const connected = view.active !== null || view.systemDefault !== "signed-out";
  return (
    <section className="conn-card" aria-label="Codex" data-state={busy ? "connecting" : connected ? "connected" : "disconnected"}>
      <header className="conn-head">
        <VendorMark agent="codex" size={18} />
        <span className="conn-name">Codex</span>
        <span className={`conn-chip ${busy ? "connecting" : connected ? "connected" : "disconnected"}`}>{busy ? "Connecting" : connected ? "Connected" : "Not connected"}</span>
      </header>
      <div className="conn-headline">{codexHeadline(view)}</div>
      {view.signingIn === "device" && view.deviceLink && view.deviceCode && (
        <div className="device-code" role="status">
          <p className="conn-detail">
            Open <span className="device-link">{view.deviceLink}</span> on this or another device, sign in, then enter:
          </p>
          <code className="device-value">{view.deviceCode}</code>
        </div>
      )}
      {view.signingIn === "browser" && view.inBrowser && <p className="conn-detail">Sign in on the ChatGPT page that opened. Kolux keeps the sign-in in a Codex home of its own.</p>}
      {!busy && (
        <div className="acct-list">
          <AccountRow
            title="System default"
            detail={`Codex's own login · ${systemRow[view.systemDefault]}`}
            active={view.active === null}
            busy={busy}
            onPick={() => onAction({ kind: "activate", id: null })}
          />
          {view.accounts.map((a) => (
            <AccountRow
              key={a.id}
              title={a.email ?? "ChatGPT account"}
              detail={`Last signed in ${signedInAt(a.lastSignIn)}`}
              active={view.active === a.id}
              busy={busy}
              trouble={codexTrouble(view, a)}
              onPick={() => onAction({ kind: "activate", id: a.id })}
              manage={{
                againLabel: codexTrouble(view, a) ? "Sign in again" : null,
                onAgain: () => onAction({ kind: "again", id: a.id }),
                confirming: confirming === a.id,
                activeGoes: view.active === a.id,
                onAsk: () => onAction({ kind: "ask-remove", id: a.id }),
                onRemove: () => onAction({ kind: "remove", id: a.id }),
                onKeep: () => onAction({ kind: "keep" }),
              }}
            />
          ))}
          {view.accounts.some((a) => view.drifted.includes(a.id)) && (
            <p className="conn-detail warn">Codex's settings file for a marked account was changed, so Codex may keep its sign-in where Kolux cannot see it. Sign in again puts Kolux's settings back.</p>
          )}
        </div>
      )}
      {!busy && view.accounts.length === 0 && view.systemDefault !== "signed-out" && <p className="conn-detail">Connect adds a ChatGPT account in a Codex home of Kolux's own; your Codex folder stays as it is.</p>}
      <AttentionNote attention={view.attention} route="codex" onFix={(f) => onAction(f === "Open install page" ? { kind: "install" } : { kind: "connect" })} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        {busy ? (
          <button className="btn" onClick={() => onAction({ kind: "cancel" })}>
            Cancel
          </button>
        ) : (
          <>
            {/* a fix shown above takes Connect's place (ACCT-013: one button that fixes it) */}
            {!fixFor(view.attention, "codex") && (
              <button className="btn primary" onClick={() => onAction({ kind: "connect" })}>
                {view.accounts.length > 0 ? "Add account" : "Connect"}
              </button>
            )}
            <button className="btn link" onClick={() => onAction({ kind: "code" })}>
              Sign in with a code
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export default function CodexCard() {
  const [view, setView] = useState<CodexView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<CodexView>("codex_accounts")
      .then(setView)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    read();
    let stop = () => {};
    listen("codex-accounts", read)
      .then((un) => (stop = un))
      .catch(() => {});
    // ACCT-020: a sign-out made in a plain terminal shows as soon as Kolux is back in front.
    window.addEventListener("focus", read);
    return () => {
      stop();
      window.removeEventListener("focus", read);
    };
  }, [read]);
  const act = (a: CodexAction) => {
    setError(null);
    setConfirming(a.kind === "ask-remove" ? a.id : null);
    if (a.kind === "ask-remove" || a.kind === "keep") return;
    const call =
      a.kind === "cancel"
        ? invoke("codex_account_cancel")
        : a.kind === "activate"
          ? invoke("codex_account_activate", { id: a.id })
          : a.kind === "remove"
            ? invoke("codex_account_remove", { id: a.id })
          : a.kind === "install"
            ? openInstallPage("codex")
            : invoke("codex_account_sign_in", { device: a.kind === "code", again: a.kind === "again" ? a.id : null });
    call.catch((e) => setError(String(e))).finally(read);
  };
  return <CodexCardView view={view} error={error} confirming={confirming} onAction={act} />;
}
