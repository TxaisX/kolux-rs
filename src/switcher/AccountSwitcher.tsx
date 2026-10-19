// T-548 (OD-11): the quick account switcher. A small pill in the top bar (beside the usage pill)
// names the account new Claude and Codex panes use; clicking it opens a menu with every managed
// account of each provider, and a click makes that one the account for NEW panes. Panes already
// running keep their account (ACCT-017). It hides itself until a provider has a managed account,
// and the accounts themselves are still added, signed in again and removed in Settings.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { buttonText, groupsOf, pickAccount, type ClaudeSwitchView, type CodexSwitchView, type Group, type Provider } from "./accounts";
import "./switcher.css";

/** Both views, re-read when either provider's accounts change; the same events Settings listens to. */
export function useAccountSwitcher(): { groups: Group[]; active: { claude: string | null; codex: string | null }; pick: (provider: Provider, id: string | null) => Promise<string | null> } {
  const [claude, setClaude] = useState<ClaudeSwitchView | null>(null);
  const [codex, setCodex] = useState<CodexSwitchView | null>(null);
  const read = useCallback(() => {
    invoke<ClaudeSwitchView>("claude_accounts").then(setClaude).catch(() => setClaude(null));
    invoke<CodexSwitchView>("codex_accounts").then(setCodex).catch(() => setCodex(null));
  }, []);
  useEffect(() => {
    read();
    const stops: Array<() => void> = [];
    let gone = false;
    for (const event of ["claude-accounts", "codex-accounts"]) {
      listen(event, read)
        .then((un) => (gone ? un() : stops.push(un)))
        .catch(() => {});
    }
    return () => {
      gone = true;
      stops.forEach((s) => s());
    };
  }, [read]);
  const groups = groupsOf(claude, codex);
  const pick = useCallback(
    async (provider: Provider, id: string | null) => {
      const group = groupsOf(claude, codex).find((g) => g.provider === provider);
      if (!group) return null;
      try {
        await pickAccount((command, args) => invoke(command, args), group, id);
        return null;
      } catch (e) {
        return String(e);
      } finally {
        read();
      }
    },
    [claude, codex, read],
  );
  const claudeActive = claude?.active ?? null;
  const codexActive = codex?.active ?? null;
  // One object per change, so a memo or an effect keyed on it does not run on every render.
  const active = useMemo(() => ({ claude: claudeActive, codex: codexActive }), [claudeActive, codexActive]);
  return { groups, active, pick };
}

type ViewProps = { groups: Group[]; open: { top: number; left: number } | null; error?: string | null; onOpen: (at: { top: number; left: number }) => void; onClose: () => void; onPick: (provider: Provider, id: string | null) => void };

export function AccountSwitcherView({ groups, open, error = null, onOpen, onClose, onPick }: ViewProps) {
  if (groups.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="acct-switch"
        title="Choose the account new panes use"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onOpen({ top: r.bottom + 4, left: Math.max(8, r.right - 260) });
        }}
      >
        <span className="acct-switch-text">{buttonText(groups)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />
          <div className="menu acct-menu" role="menu" aria-label="Accounts for new panes" style={open} onKeyDown={(e) => e.key === "Escape" && onClose()}>
            {groups.map((g) => (
              <div key={g.provider} role="group" aria-label={`${g.name} accounts`}>
                <div className="menu-title">{g.name}</div>
                {g.choices.map((c) => (
                  <button key={c.id ?? "default"} role="menuitemradio" aria-checked={c.active} className="menu-item" disabled={g.busy} autoFocus={c.active} title={c.active ? `New ${g.name} panes use this account` : `Use this account for new ${g.name} panes`} onClick={() => (c.active ? onClose() : onPick(g.provider, c.id))}>
                    <span className="name">{c.label}</span>
                    {c.trouble && <span className="acct-trouble">{c.trouble}</span>}
                    <span className="acct-check" aria-hidden="true">{c.active ? "✓" : ""}</span>
                  </button>
                ))}
                {g.busy && <div className="menu-hint">A sign-in is running. Finish or cancel it in Settings first.</div>}
                {g.note && <div className="menu-hint">{g.note}</div>}
              </div>
            ))}
            <div className="menu-hint">Panes already running keep their account.</div>
            {error && (
              <div className="menu-hint acct-error" role="alert">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** The top-bar mount: `<AccountSwitcher />` in the right-hand group, before the usage pill. */
export default function AccountSwitcher() {
  const { groups, pick } = useAccountSwitcher();
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <AccountSwitcherView
      groups={groups}
      open={open}
      error={error}
      onOpen={(at) => (setError(null), setOpen(at))}
      onClose={() => setOpen(null)}
      onPick={(provider, id) =>
        void pick(provider, id).then((failed) => {
          setError(failed);
          if (!failed) setOpen(null);
        })
      }
    />
  );
}
