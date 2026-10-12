// Settings, laid over the window body (the panes underneath stay mounted and untouched). Its first
// page is AI connections (ACCT-004): the Claude card connects on the 1-year key by default. The
// other Connect cards and their install steps come with T-092 (ACCT-001..003); the Claude account
// route and the Codex sign-ins with T-043-b / T-043-c (both in).
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { actionLabel, keyCard, ownSignInLine, RESUME_FIELD, resumeOn, type KeyAction, type KeyStatus, type OwnSignIn } from "./claudeKey";
import ClaudeAccounts, { addClaudeAccount } from "./ClaudeAccounts";
import CodexCard from "./CodexCard";
import { AttentionNote, openInstallPage, type Fix } from "./Attention";
import Notifications from "./Notifications";
import AgentsPage from "./AgentsPage";

const TITLES = { connections: "AI connections", agents: "Agents", notifications: "Notifications" } as const;

export function ClaudeCardView({ status, busy, error, onAction, onUseAccount, own = null, resume = false, onResume }: { status: KeyStatus | null; busy: boolean; error?: string | null; onAction: (a: KeyAction) => void; onUseAccount?: () => void; own?: OwnSignIn | null; resume?: boolean; onResume?: (on: boolean) => void }) {
  const card = keyCard(status);
  const ownLine = card.state === "disconnected" || card.state === "attention" ? ownSignInLine(own) : null;
  const fix = (f: Fix) => (f === "Open install page" ? void openInstallPage("claude").catch(() => {}) : onAction("connect"));
  const chip = card.state === "connected" || card.state === "warning" ? "Connected" : card.state === "expired" ? "Ran out" : card.state === "connecting" ? "Connecting" : card.state === "attention" ? "Needs attention" : card.state === "reading" ? "" : "Not connected";
  return (
    <section className="conn-card" data-state={card.state} aria-label="Claude">
      <header className="conn-head">
        <VendorMark agent="claude" size={18} />
        <span className="conn-name">Claude</span>
        {chip && <span className={`conn-chip ${card.state}`}>{chip}</span>}
      </header>
      <div className="conn-headline">{card.headline}</div>
      {card.detail && <p className={card.state === "warning" || card.state === "expired" || card.state === "attention" ? "conn-detail warn" : "conn-detail"}>{card.detail}</p>}
      {ownLine && <p className={ownLine.warn ? "conn-detail warn own-sign-in" : "conn-detail own-sign-in"}>{ownLine.text}</p>}
      <AttentionNote attention={card.attention} route="claude-key" busy={busy} offer={card.state === "attention"} onFix={fix} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        {card.actions.map((a) => (
          <button key={a} className={a === "connect" || a === "renew" ? "btn primary" : a === "disconnect" ? "btn danger" : "btn"} disabled={busy && a !== "cancel"} onClick={() => onAction(a)}>
            {actionLabel[a]}
          </button>
        ))}
        {onUseAccount && (card.state === "disconnected" || card.state === "attention") && (
          <button className="btn link" disabled={busy} onClick={onUseAccount}>
            Use my Claude account instead
          </button>
        )}
      </div>
      {onResume && (
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={resume} onChange={(e) => onResume(e.target.checked)} />
          <span>
            Carry on by itself once a usage limit resets
            <small>Off unless you turn it on. Kolux saves the choice now; the resume itself is not built yet.</small>
          </span>
        </label>
      )}
    </section>
  );
}

function ClaudeCard() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [own, setOwn] = useState<OwnSignIn | null>(null);
  const [resume, setResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<KeyStatus>("claude_key_status")
      .then(setStatus)
      .catch((e) => setError(String(e)));
    invoke<OwnSignIn | null>("claude_own_sign_in")
      .then(setOwn)
      .catch(() => setOwn(null));
  }, []);
  useEffect(() => {
    read();
    invoke<Record<string, unknown>>("get_settings")
      .then((s) => setResume(resumeOn(s)))
      .catch(() => {});
    const offs = [listen("claude-key", read), listen("claude-accounts", read)];
    return () => offs.forEach((o) => void o.then((u) => u()).catch(() => {}));
  }, [read]);
  const saveResume = (on: boolean) => {
    setResume(on);
    invoke<Record<string, unknown>>("get_settings")
      .then((s) => invoke("save_settings", { value: { ...s, [RESUME_FIELD]: on } }))
      .catch((e) => {
        setResume(!on);
        setError(String(e));
      });
  };
  // While a setup runs the days-left figure cannot change, but its browser step can: read again.
  useEffect(() => {
    if (!status?.settingUp) return;
    const t = window.setInterval(read, 1000);
    return () => window.clearInterval(t);
  }, [status?.settingUp, read]);
  const act = (a: KeyAction) => {
    setError(null);
    const command = a === "cancel" ? "claude_key_cancel" : a === "disconnect" ? "claude_key_disconnect" : "claude_key_connect";
    setBusy(a !== "cancel");
    invoke(command)
      .catch((e) => setError(String(e)))
      .finally(() => {
        setBusy(false);
        read();
      });
  };
  const useAccount = () => {
    setError(null);
    addClaudeAccount().catch((e) => setError(String(e)));
  };
  return <ClaudeCardView status={status} busy={busy} error={error} onAction={act} onUseAccount={useAccount} own={own} resume={resume} onResume={saveResume} />;
}

export default function SettingsPage({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<keyof typeof TITLES>("connections");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="settings" role="dialog" aria-label="Settings">
      <nav className="settings-nav" aria-label="Settings pages">
        <div className="settings-title">Settings</div>
        {(Object.keys(TITLES) as Array<keyof typeof TITLES>).map((id) => (
          <button key={id} className="settings-link" aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)}>
            {TITLES[id]}
          </button>
        ))}
      </nav>
      <main className="settings-main">
        <header className="settings-head">
          <h1>{TITLES[page]}</h1>
          <button className="ib" title="Close Settings (Esc)" aria-label="Close Settings" onClick={onClose}>
            ×
          </button>
        </header>
        {page === "connections" ? (
          <>
            <p className="settings-sub">Link Kolux to the AI services you already pay for. Keys and sign-ins are sealed on this PC for your Windows account only.</p>
            <ClaudeCard />
            <ClaudeAccounts />
            <CodexCard />
          </>
        ) : page === "agents" ? (
          <>
            <p className="settings-sub">How Kolux starts the agents it runs for you.</p>
            <AgentsPage />
          </>
        ) : (
          <>
            <p className="settings-sub">What Kolux tells you while you are away from a pane.</p>
            <Notifications />
          </>
        )}
      </main>
    </div>
  );
}
