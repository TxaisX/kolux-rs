// Settings, laid over the window body (the panes underneath stay mounted and untouched). Its first
// page is AI connections (ACCT-004): the Claude card connects on the 1-year key by default. The
// other Connect cards and their install steps come with T-092 (ACCT-001..003); the Claude account
// route and the Codex sign-ins with T-043-b / T-043-c (both in).
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { actionLabel, keyCard, type KeyAction, type KeyStatus } from "./claudeKey";
import ClaudeAccounts, { addClaudeAccount } from "./ClaudeAccounts";
import CodexCard from "./CodexCard";
import { AttentionNote, openInstallPage, type Fix } from "./Attention";

export function ClaudeCardView({ status, busy, error, onAction, onUseAccount }: { status: KeyStatus | null; busy: boolean; error?: string | null; onAction: (a: KeyAction) => void; onUseAccount?: () => void }) {
  const card = keyCard(status);
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
    </section>
  );
}

function ClaudeCard() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<KeyStatus>("claude_key_status")
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    read();
    let stop = () => {};
    listen("claude-key", read)
      .then((un) => (stop = un))
      .catch(() => {});
    return () => stop();
  }, [read]);
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
  return <ClaudeCardView status={status} busy={busy} error={error} onAction={act} onUseAccount={useAccount} />;
}

export default function SettingsPage({ onClose }: { onClose: () => void }) {
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
        <button className="settings-link" aria-current="page">
          AI connections
        </button>
      </nav>
      <main className="settings-main">
        <header className="settings-head">
          <h1>AI connections</h1>
          <button className="ib" title="Close Settings (Esc)" aria-label="Close Settings" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="settings-sub">Link Kolux to the AI services you already pay for. Keys and sign-ins are sealed on this PC for your Windows account only.</p>
        <ClaudeCard />
        <ClaudeAccounts />
        <CodexCard />
      </main>
    </div>
  );
}
