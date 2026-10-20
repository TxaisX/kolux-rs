// VIEW-080 / VIEW-083 / VIEW-085 (T-168, T-169): the Agents tab of the right sidebar, the past
// sessions of every agent in this scope. The list refreshes when the tab is shown or the window is
// refocused (from cache), when the Refresh button is pressed (a full rescan) and a moment after an
// agent starts; results are drawn only once typing has paused. Resume opens a terminal in the
// session's folder; Copy command copies the same command for the shell the tab runs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./sessions.css";
import { ago, type Session } from "./model";
import { effectiveScope, readScope, readView, SCOPE_KEY, VIEW_KEY, type Scope } from "./prefs";
import { AFTER_START_MS, publishDelay, recall, remember, RescanLimiter } from "./refresh";
import { dragPayload, planFor, resumeBlock, SESSION_DRAG, type ResumePlan } from "./resume";

export type PanelProps = {
  /** The window's settings and the way to save one (the view options and the scope live there, so every window sees them). */
  settings: Record<string, unknown>;
  onSave: (key: string, value: unknown) => void;
  /** The workspace in front, and every workspace folder of its project (worktrees and the root). */
  activeDir: string | null;
  projectDirs: string[];
  /** Changes whenever an agent starts in Kolux; the list rescans a moment later, at most every few seconds. */
  rescanKey: number;
  visible: boolean;
  /** The program of the shell the new tab runs, so the copied command is written for it. */
  shell: string | null;
  onResume: (s: Session, plan: ResumePlan) => void;
};

/** What the back end is asked for under the saved scope and depth. */
export function request(settings: Record<string, unknown>, activeDir: string | null, projectDirs: string[]): { dirs: string[]; all: boolean; depth: number | null; scope: Scope } {
  const scope = effectiveScope(readScope(settings[SCOPE_KEY]), { workspace: activeDir !== null, project: projectDirs.length > 0 });
  const dirs = scope === "workspace" ? (activeDir === null ? [] : [activeDir]) : scope === "project" ? projectDirs : [];
  return { dirs, all: scope === "all", depth: readView(settings[VIEW_KEY]).depth, scope };
}

const scopeKey = (p: { dirs: string[]; all: boolean; depth: number | null }) => JSON.stringify([p.all, p.all ? [] : p.dirs, p.depth]);

/** The time of the last key pressed anywhere in the window (terminal typing included). */
function useLastKey() {
  const at = useRef(0);
  useEffect(() => {
    const on = () => void (at.current = Date.now());
    document.addEventListener("keydown", on, true);
    return () => document.removeEventListener("keydown", on, true);
  }, []);
  return at;
}

export default function AgentsPanel(props: PanelProps) {
  const { settings, activeDir, projectDirs, rescanKey, visible, shell, onResume } = props;
  const { dirs, all, depth } = request(settings, activeDir, projectDirs);
  const key = scopeKey({ dirs, all, depth });
  const [list, setList] = useState<Session[] | null>(() => recall<Session[]>(key) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lastKey = useLastKey();
  const live = useRef({ key, dirs, all, depth });
  live.current = { key, dirs, all, depth };
  const timer = useRef<number | null>(null);
  const limiter = useRef(new RescanLimiter());

  const load = useCallback(
    (force: boolean) => {
      const asked = live.current;
      setBusy(true);
      invoke<Session[]>("sessions_list", { dirs: asked.dirs, all: asked.all, depth: asked.depth, force })
        .then((rows) => {
          const arrived = Date.now();
          const publish = () => {
            timer.current = null;
            remember(asked.key, rows);
            if (live.current.key === asked.key) {
              setList(rows);
              setError(null);
            }
            setBusy(false);
          };
          if (timer.current !== null) window.clearTimeout(timer.current);
          // VIEW-083: results wait for a pause in typing, at most one second.
          timer.current = window.setTimeout(publish, publishDelay(Date.now(), lastKey.current, arrived));
        })
        .catch((err) => {
          setError(String(err));
          setBusy(false);
        });
    },
    [lastKey],
  );

  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), []);
  // Showing the tab, or another scope, reads from cache; the last results for that scope show at once.
  useEffect(() => {
    setList(recall<Session[]>(key) ?? null);
    if (visible) load(false);
  }, [key, visible, load]);
  useEffect(() => {
    if (!visible) return;
    const on = () => load(false);
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, [visible, load]);
  // An agent started: its session file appears a moment later; at most one rescan per interval.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!visible || !limiter.current.allow(Date.now())) return;
    const t = window.setTimeout(() => load(false), AFTER_START_MS);
    return () => window.clearTimeout(t);
  }, [rescanKey]);

  const resume = (s: Session) => {
    setNote(null);
    planFor(s, activeDir, shell).then(
      (plan) => onResume(s, plan),
      (err) => setNote(String(err)),
    );
  };
  const copy = (s: Session) => {
    setNote(null);
    planFor(s, activeDir, shell).then(
      (plan) => navigator.clipboard.writeText(plan.copy).then(() => setNote("Resume command copied."), () => setNote(`Copy it from here: ${plan.copy}`)),
      (err) => setNote(String(err)),
    );
  };
  const now = Date.now();
  const rows = useMemo(() => list ?? [], [list]);

  return (
    <div className="agents-panel" aria-label="Agents">
      <div className="agents-bar">
        <span className="agents-count">{list === null ? (error === null ? "Looking for past sessions…" : "") : `${rows.length} past session${rows.length === 1 ? "" : "s"}`}</span>
        <button type="button" className="btn" title="Rescan every session folder" disabled={busy} onClick={() => load(true)}>
          {busy ? "Scanning…" : "Refresh"}
        </button>
      </div>
      {error !== null && (
        <div className="sb-hint warn" role="alert">
          Past sessions could not be read: {error}
        </div>
      )}
      {note !== null && (
        <div className="sb-hint" role="status">
          {note}
        </div>
      )}
      {list !== null && rows.length === 0 && error === null && <div className="sb-hint">No past sessions here yet. Sessions of Claude and Codex show up once they have run.</div>}
      <ul className="agents-list">
        {rows.map((s) => {
          const block = resumeBlock(s);
          return (
            <li key={`${s.agent}:${s.id}`} className="agents-row" draggable onDragStart={(e) => e.dataTransfer.setData(SESSION_DRAG, dragPayload(s))}>
              <div className="agents-title" title={s.title}>
                {s.title === "" ? "Untitled session" : s.title}
              </div>
              <div className="agents-meta">
                {s.agent} · {ago(s.modifiedMs, now)} · {s.turns} message{s.turns === 1 ? "" : "s"}
              </div>
              <div className="agents-actions">
                <button type="button" className="btn" disabled={block !== null} title={block ?? "Open a terminal and continue this session"} onClick={() => resume(s)}>
                  Resume
                </button>
                <button type="button" className="btn" title="Copy the command that resumes this session" onClick={() => copy(s)}>
                  Copy command
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
