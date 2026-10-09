// The Claude accounts section of Settings > AI connections (ACCT-005): each managed account
// signs in through the browser into its own private Claude folder and is listed with its email
// and organisation; one can be made active for new Claude panes. While the 1-year key (ACCT-004)
// is connected it wins for new panes, and the section says so. The full list with the system
// default and safe switching is T-138 (ACCT-016..018).
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Account = { id: string; email: string | null; organization: string | null; configDir: string; lastSignIn: number };
export type AccountsView = {
  accounts: Account[];
  active: string | null;
  signingIn: string | null;
  inBrowser: boolean;
  attention: string | null;
  keyMode: boolean;
  upkeepLeftToClaude: boolean;
};

export type AccountAction = { kind: "add" } | { kind: "again"; id: string } | { kind: "activate"; id: string } | { kind: "cancel" };

export function ClaudeAccountsView({ view, error, onAction }: { view: AccountsView | null; error?: string | null; onAction: (a: AccountAction) => void }) {
  if (!view) return null;
  const busy = view.signingIn !== null;
  return (
    <section className="conn-card" aria-label="Claude accounts">
      <header className="conn-head">
        <span className="conn-name">Claude accounts</span>
        {!busy && (
          <button className="btn conn-add" onClick={() => onAction({ kind: "add" })}>
            Add Account
          </button>
        )}
      </header>
      {busy && (
        <div className="acct-pending" role="status">
          <span>{view.inBrowser ? "Finish signing in in the browser." : "Starting Claude Code's sign-in…"}</span>
          <button className="btn" onClick={() => onAction({ kind: "cancel" })}>
            Cancel
          </button>
        </div>
      )}
      {view.accounts.length === 0 && !busy && <p className="conn-detail">No managed accounts. Add one to run Claude panes on a Claude account of its own.</p>}
      {view.accounts.map((a) => {
        const isActive = view.active === a.id;
        return (
          <div key={a.id} className="acct-row" data-active={isActive}>
            <div className="acct-who">
              <span className="acct-email">{a.email ?? "Claude account"}</span>
              <span className="acct-org">{a.organization ?? "No organisation"}</span>
            </div>
            {isActive ? <span className="conn-chip connected">Active</span> : null}
            <div className="btn-row">
              {!isActive && (
                <button className="btn" disabled={busy} onClick={() => onAction({ kind: "activate", id: a.id })}>
                  Make active
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => onAction({ kind: "again", id: a.id })}>
                Sign in again
              </button>
            </div>
          </div>
        );
      })}
      {view.keyMode && view.active && <p className="conn-detail">The 1-year key is connected, so new Claude panes use the key. Disconnect it to run them on the active account.</p>}
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
      {view.upkeepLeftToClaude && view.accounts.length > 0 && <p className="conn-detail">Claude Code keeps these sign-ins fresh in its own panes; Kolux sends nothing to Anthropic's sign-in service.</p>}
    </section>
  );
}

/** Starts a sign-in for a new account; the Claude card's "Use my Claude account instead". */
export function addClaudeAccount(): Promise<void> {
  return invoke("claude_account_sign_in", { id: null });
}

export default function ClaudeAccounts() {
  const [view, setView] = useState<AccountsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<AccountsView>("claude_accounts")
      .then(setView)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    read();
    let stop = () => {};
    listen("claude-accounts", read)
      .then((un) => (stop = un))
      .catch(() => {});
    return () => stop();
  }, [read]);
  const act = (a: AccountAction) => {
    setError(null);
    const call =
      a.kind === "add"
        ? addClaudeAccount()
        : a.kind === "again"
          ? invoke("claude_account_sign_in", { id: a.id })
          : a.kind === "activate"
            ? invoke("claude_account_activate", { id: a.id })
            : invoke("claude_account_cancel");
    call.catch((e) => setError(String(e))).finally(read);
  };
  return <ClaudeAccountsView view={view} error={error} onAction={act} />;
}
