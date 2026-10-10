// Settings, laid over the window body (the panes underneath stay mounted and untouched). Its first
// page is AI connections (ACCT-004): the Claude card connects on the 1-year key by default. The
// other Connect cards and their install steps come with T-092 (ACCT-001..003); the Claude account
// route and the Codex sign-ins with T-043-b / T-043-c (both in).
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { actionLabel, keyCard, ownSignInLine, RESUME_FIELD, resumeOn, type KeyAction, type KeyStatus, type OwnSignIn } from "./claudeKey";
import ClaudeAccounts, { addClaudeAccount } from "./ClaudeAccounts";
import CodexCard from "./CodexCard";
import { AttentionNote, openInstallPage, type Fix } from "./Attention";
import type { Project } from "../projects/model";
import { PAGES, pageOf, rememberPage, lastPage, type Page, type SettingsTarget } from "./pages";

// SET-006: a page loads the first time it is opened, so Settings itself opens quickly.
const AppearancePage = lazy(() => import("./AppearancePage"));
const GeneralPage = lazy(() => import("./GeneralPage"));
const ShortcutsPage = lazy(() => import("./ShortcutsPage"));
const TerminalPage = lazy(() => import("./TerminalPage"));
const GitPage = lazy(() => import("./GitPage"));

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

const later = <p className="conn-detail">Nothing to set here yet.</p>;

function RepoPage({ project }: { project: Project }) {
  return (
    <section className="conn-card" data-section="repo">
      <h2 className="conn-name">{project.name}</h2>
      <p className="conn-detail">Folder: {project.path}</p>
      <p className="conn-detail">Workspaces folder: {project.workspacesDir || "the global one (Git & worktrees)"}</p>
      <p className="conn-detail">New workspaces start from: {project.base || "the default branch"}</p>
    </section>
  );
}

/** Scrolls a section of the open page into view once it is drawn (pages load lazily). */
function useScrollTo(section: string | undefined, page: Page, n: number) {
  useEffect(() => {
    if (!section) return;
    let frames = 0;
    let raf = 0;
    const look = () => {
      const el = document.querySelector<HTMLElement>(`.settings-main [data-section="${CSS.escape(section)}"]`);
      if (el) {
        el.scrollIntoView({ block: "start" });
        el.classList.add("settings-section-flash");
        window.setTimeout(() => el.classList.remove("settings-section-flash"), 1200);
      } else if (++frames < 180) raf = requestAnimationFrame(look);
    };
    raf = requestAnimationFrame(look);
    return () => cancelAnimationFrame(raf);
  }, [section, page, n]);
}

/** `target` comes from a link elsewhere in the app; `n` changes on every open so a repeat link scrolls again. */
export default function SettingsPage({ onClose, target, n = 0 }: { onClose: () => void; target?: SettingsTarget | null; n?: number }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState<Page>(() => pageOf(target?.page ?? lastPage(), []));
  useEffect(() => {
    invoke<Project[]>("project_list")
      .then((list) => {
        setProjects(list);
        // A remembered repository page waits for the list before it can be shown.
        if (!target) setPage(pageOf(lastPage(), list.map((p) => p.id)));
      })
      .catch(() => setProjects([]));
  }, [target]);
  useEffect(() => {
    if (target) setPage(target.page);
  }, [target, n]);
  useEffect(() => rememberPage(page), [page]);
  useScrollTo(target?.section, page, n);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const repo = page.startsWith("repo:") ? projects.find((p) => `repo:${p.id}` === page) : undefined;
  const title = repo ? repo.name : page in PAGES ? PAGES[page as keyof typeof PAGES] : "";
  return (
    <div className="settings" role="dialog" aria-label="Settings">
      <nav className="settings-nav" aria-label="Settings pages">
        <div className="settings-title">Settings</div>
        {(Object.keys(PAGES) as Array<keyof typeof PAGES>).map((p) => (
          <button key={p} className="settings-link" aria-current={page === p ? "page" : undefined} onClick={() => setPage(p)}>
            {PAGES[p]}
          </button>
        ))}
        {projects.length > 0 && <div className="settings-group">Repositories</div>}
        {projects.map((p) => (
          <button key={p.id} className="settings-link repo" aria-current={page === `repo:${p.id}` ? "page" : undefined} onClick={() => setPage(`repo:${p.id}`)}>
            {p.name}
          </button>
        ))}
      </nav>
      <main className="settings-main">
        <header className="settings-head">
          <h1>{title}</h1>
          <button className="ib" title="Close Settings (Esc)" aria-label="Close Settings" onClick={onClose}>
            ×
          </button>
        </header>
        <Suspense fallback={null}>
          {page === "general" && <GeneralPage />}
          {page === "appearance" && (
            <>
              <p className="settings-sub">How Kolux looks. Changes show straight away.</p>
              <AppearancePage />
            </>
          )}
          {page === "accounts" && (
            <>
              <p className="settings-sub">Link Kolux to the AI services you already pay for. Keys and sign-ins are sealed on this PC for your Windows account only.</p>
              <ClaudeCard />
              <ClaudeAccounts />
              <CodexCard />
            </>
          )}
          {page === "shortcuts" && <ShortcutsPage />}
          {page === "terminal" && <TerminalPage />}
          {page === "git" && <GitPage />}
          {(page === "agents" || page === "safety" || page === "notifications" || page === "usage") && later}
          {repo && <RepoPage project={repo} />}
        </Suspense>
      </main>
    </div>
  );
}
