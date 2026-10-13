// The Codex card on Settings > AI connections (ACCT-007): Connect signs a ChatGPT account in
// through the browser, "Sign in with a code" shows a link and a one-time code to enter on any
// device. Each account Kolux adds runs in a private Codex home; the user's own Codex folder is
// never touched. A System default row reports Codex's own login as it is, re-read whenever Kolux
// gets focus (ACCT-020); managed rows can be picked, re-signed or removed (ACCT-019, T-138). The
// full Connect-card states are T-092; T-138-b: the user names accounts, and two on one email ask
// to be named, since OpenAI does not document where a sign-in says personal or business. The card
// is in one state at a time (ACCT-002); the accounts list moving under Manage accounts is T-138.
// Once connected the card shows Manage and Disconnect (ACCT-015): Disconnect removes only an
// account Kolux made, and for Codex's own login only explains how to sign out in Codex.
import { useCallback, useEffect, useState } from "react";
import { AccountRow, signedInAt } from "./AccountRow";
import { invoke } from "@tauri-apps/api/core";
import { AttentionNote, fixFor, openInstallPage, type Attention } from "./Attention";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { OtherWays, taglineOf } from "./ConnectGrid";
import { settleWithin } from "./pending";
import CloseAsk, { type Ask } from "../terminal/CloseAsk";
import { CONNECT } from "../glossary";

export type CodexAccount = { id: string; email: string | null; home: string; lastSignIn: number; signInError: boolean; label?: string };
const NAME_MAX = 40;
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
export type CodexAction = { kind: "connect" } | { kind: "code" } | { kind: "cancel" } | { kind: "activate"; id: string | null } | { kind: "ask-remove"; id: string } | { kind: "remove"; id: string } | { kind: "keep" } | { kind: "name"; id: string } | { kind: "label"; id: string; label: string } | { kind: "again"; id: string } | { kind: "install" } | { kind: "disconnect" };

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

const who = (a: CodexAccount) => a.email ?? "ChatGPT account";
/** ACCT-019: another listed account signs in with the same email. */
export const sharesEmail = (v: CodexView, a: CodexAccount) => !!a.email && v.accounts.some((b) => b.id !== a.id && b.email?.toLowerCase() === a.email?.toLowerCase());

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
  if (active) return `Connected · ${active.label ? `${active.label} · ` : ""}${who(active)}`;
  if (v.systemDefault !== "signed-out") return `Connected · Codex's own login (${systemLabel[v.systemDefault]})`;
  return "Connect with your ChatGPT plan";
}

/** ACCT-015: what Disconnect asks. Only the active account Kolux made is removed. */
export function codexDisconnect(v: CodexView): Ask {
  const active = v.accounts.find((a) => a.id === v.active);
  if (active)
    return {
      title: `Disconnect ${active.email ?? "this ChatGPT account"}?`,
      body: "Kolux removes this account and deletes the Codex home and saved sign-in it made for it. Your own Codex folder and its login stay as they are.",
      confirm: "Disconnect",
    };
  return { title: "Codex's own login stays", body: "Kolux did not make this sign-in, so Disconnect deletes nothing. To sign out of Codex itself, run codex logout in a terminal.", confirm: null };
}

export type CodexState = "connecting" | "connected" | "attention" | "disconnected";
export function codexState(v: CodexView): CodexState {
  if (v.signingIn !== null) return "connecting";
  if (v.active !== null || v.systemDefault !== "signed-out") return "connected";
  return v.attention ? "attention" : "disconnected";
}
const codexChip: Record<CodexState, string> = { connecting: "Connecting", connected: "Connected", attention: "Needs attention", disconnected: "Not connected" };

export function CodexCardView({ view, error, confirming = null, pending = false, naming = null, onAction }: { view: CodexView | null; error?: string | null; confirming?: string | null; pending?: boolean; naming?: string | null; onAction: (a: CodexAction) => void }) {
  if (!view) return null;
  const state = codexState(view);
  const busy = state === "connecting";
  return (
    <section className="conn-card" aria-label="Codex" data-state={state}>
      <header className="conn-head">
        <VendorMark agent="codex" size={18} />
        <span className="conn-name">Codex</span>
        <span className={`conn-chip ${state}`}>{codexChip[state]}</span>
      </header>
      <p className="conn-detail conn-tagline">{taglineOf("codex")}</p>
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
              title={a.label ? `${a.label} · ${who(a)}` : who(a)}
              detail={!a.label && sharesEmail(view, a) ? "Same email as another account: name it, e.g. Work" : `Last signed in ${signedInAt(a.lastSignIn)}`}
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
                nameLabel: a.label ? "Rename" : "Name",
                onName: () => onAction({ kind: "name", id: a.id }),
              }}
              below={
                naming === a.id && (
                  <input
                    className="field acct-name"
                    aria-label={`Name for ${who(a)}`}
                    placeholder="Personal, Work…"
                    maxLength={NAME_MAX}
                    defaultValue={a.label ?? ""}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        onAction({ kind: "keep" });
                      }
                    }}
                    onBlur={(e) => onAction({ kind: "label", id: a.id, label: e.currentTarget.value })}
                  />
                )
              }
            />
          ))}
          {view.accounts.some((a) => view.drifted.includes(a.id)) && (
            <p className="conn-detail warn">Codex's settings file for a marked account was changed, so Codex may keep its sign-in where Kolux cannot see it. Sign in again puts Kolux's settings back.</p>
          )}
        </div>
      )}
      {!busy && view.accounts.length === 0 && view.systemDefault !== "signed-out" && <p className="conn-detail">{CONNECT.codex}</p>}
      <AttentionNote attention={view.attention} route="codex" busy={pending} onFix={(f) => onAction(f === "Open install page" ? { kind: "install" } : { kind: "connect" })} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        {/* Cancel ends a sign-in, or with nothing running wipes a leftover needs-attention state */}
        {(busy || view.attention) && (
          <button className="btn" onClick={() => onAction({ kind: "cancel" })}>
            Cancel
          </button>
        )}
        {state === "connected" && (
          <>
            <OtherWays
              label="Manage"
              ways={[
                { label: "Add account", onPick: () => onAction({ kind: "connect" }), disabled: pending },
                { label: "Sign in with a code", onPick: () => onAction({ kind: "code" }), disabled: pending },
              ]}
            />
            <button className="btn danger" disabled={pending} onClick={() => onAction({ kind: "disconnect" })}>
              Disconnect
            </button>
          </>
        )}
        {!busy && state !== "connected" && (
          <>
            {/* a fix shown above takes Connect's place (ACCT-013: one button that fixes it) */}
            {!fixFor(view.attention, "codex") && (
              <button className="btn primary" disabled={pending} onClick={() => onAction({ kind: "connect" })}>
                {view.accounts.length > 0 ? "Add account" : "Connect"}
              </button>
            )}
            <OtherWays ways={[{ label: "Sign in with a code", onPick: () => onAction({ kind: "code" }), disabled: pending }]} />
          </>
        )}
      </div>
    </section>
  );
}

/** `onConnected`: told whether Codex counts as connected each time that changes (ONB-003). */
export default function CodexCard({ onConnected = () => {} }: { onConnected?: (on: boolean) => void } = {}) {
  const [view, setView] = useState<CodexView | null>(null);
  const on = !!view && codexState(view) === "connected";
  useEffect(() => onConnected(on), [onConnected, on]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
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
  const [ask, setAsk] = useState<Ask | null>(null);
  const act = (a: CodexAction) => {
    setError(null);
    setConfirming(a.kind === "ask-remove" ? a.id : null);
    setNaming(a.kind === "name" ? a.id : null);
    if (a.kind === "ask-remove" || a.kind === "keep" || a.kind === "name") return;
    if (a.kind === "disconnect") return view && setAsk(codexDisconnect(view));
    const call =
      a.kind === "cancel"
        ? invoke("codex_account_cancel")
        : a.kind === "remove"
          ? invoke("codex_account_remove", { id: a.id })
          : a.kind === "activate"
          ? invoke("codex_account_activate", { id: a.id })
          : a.kind === "label"
            ? invoke("codex_account_label", { id: a.id, label: a.label })
          : a.kind === "install"
            ? openInstallPage("codex")
            : invoke("codex_account_sign_in", { device: a.kind === "code", again: a.kind === "again" ? a.id : null });
    if (a.kind !== "cancel") setPending(true);
    call.catch((e) => setError(String(e)));
    // ACCT-002: a choice comes back after 30 seconds even if no answer arrives.
    void settleWithin(call).then(() => {
      setPending(false);
      read();
    });
  };
  return (
    <>
      <CodexCardView view={view} error={error} confirming={confirming} pending={pending} naming={naming} onAction={act} />
      {ask && (
        <CloseAsk
          {...ask}
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            setAsk(null);
            if (view?.active) act({ kind: "remove", id: view.active });
          }}
        />
      )}
    </>
  );
}
