// The Codex card on Settings > AI connections (ACCT-007): Connect signs a ChatGPT account in
// through the browser, "Sign in with a code" shows a link and a one-time code to enter on any
// device. Each account Kolux adds runs in a private Codex home; the user's own Codex folder is
// never touched. Without a managed account the card reports Codex's own login as it is. The full
// Connect-card states and the accounts list are T-092 and T-138.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";

export type CodexAccount = { id: string; email: string | null; home: string; lastSignIn: number };
export type CodexView = {
  accounts: CodexAccount[];
  active: string | null;
  systemDefault: "chatgpt" | "api-key" | "custom-provider" | "signed-out";
  signingIn: "browser" | "device" | null;
  inBrowser: boolean;
  deviceLink: string | null;
  deviceCode: string | null;
  attention: string | null;
};
export type CodexAction = { kind: "connect" } | { kind: "code" } | { kind: "cancel" } | { kind: "activate"; id: string };

const systemLabel: Record<CodexView["systemDefault"], string> = {
  chatgpt: "a ChatGPT sign-in",
  "api-key": "an API key",
  "custom-provider": "an API key with a custom provider",
  "signed-out": "",
};

export function codexHeadline(v: CodexView): string {
  if (v.signingIn === "device") return v.deviceCode ? "Enter the code on any device" : "Asking for a sign-in code…";
  if (v.signingIn) return v.inBrowser ? "Finish signing in in the browser" : "Starting Codex's sign-in…";
  const active = v.accounts.find((a) => a.id === v.active);
  if (active) return `Connected · ${active.email ?? "ChatGPT account"}`;
  if (v.systemDefault !== "signed-out") return `Connected · Codex's own login (${systemLabel[v.systemDefault]})`;
  return "Connect with your ChatGPT plan";
}

export function CodexCardView({ view, error, onAction }: { view: CodexView | null; error?: string | null; onAction: (a: CodexAction) => void }) {
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
      {!busy && view.accounts.length > 0 && (
        <div className="acct-list">
          {view.accounts.map((a) => (
            <div key={a.id} className="acct-row" data-active={view.active === a.id}>
              <div className="acct-who">
                <span className="acct-email">{a.email ?? "ChatGPT account"}</span>
              </div>
              {view.active === a.id ? (
                <span className="conn-chip connected">Active</span>
              ) : (
                <button className="btn" onClick={() => onAction({ kind: "activate", id: a.id })}>
                  Make active
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!busy && view.accounts.length === 0 && view.systemDefault !== "signed-out" && <p className="conn-detail">Connect adds a ChatGPT account in a Codex home of Kolux's own; your Codex folder stays as it is.</p>}
      {view.attention && (
        <p className="conn-detail warn" role="alert">
          {view.attention}
        </p>
      )}
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
            <button className="btn primary" onClick={() => onAction({ kind: "connect" })}>
              {view.accounts.length > 0 ? "Add account" : "Connect"}
            </button>
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
    return () => stop();
  }, [read]);
  const act = (a: CodexAction) => {
    setError(null);
    const call =
      a.kind === "cancel"
        ? invoke("codex_account_cancel")
        : a.kind === "activate"
          ? invoke("codex_account_activate", { id: a.id })
          : invoke("codex_account_sign_in", { device: a.kind === "code" });
    call.catch((e) => setError(String(e))).finally(read);
  };
  return <CodexCardView view={view} error={error} onAction={act} />;
}
