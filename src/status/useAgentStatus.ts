// T-543: the agent status the window tracks per pane, moved out of App.tsx as it was. Two hooks,
// because the events need what the grid shows (`inView`), which the window works out later in its
// render: useAgentStatusState is called where the state used to sit, useAgentEvents where the
// listeners used to sit, so the window's hook and effect order is unchanged.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Pane } from "../App";
import type { AgentState } from "../projects/rows";
import type { Crew } from "../terminal/status";
import { noteTitle, turnNote, type StopInfo, type Turn } from "../terminal/notify";
import type { ContextReading } from "../usage/meter";
import type { KindKey } from "../settings/notifications";
import { marksUnread } from "../terminal/tabs";
import { folderName } from "../projects/model";
import { sameDir } from "../workspaces";

export type TurnInfo = { tool?: string; detail?: string; reply?: string; wrote?: string; stop?: StopInfo; plan?: string; planCut?: boolean };

export function useAgentStatusState(running: Record<number, boolean>) {
  const [needs, setNeeds] = useState<Record<number, boolean>>({}); // TERM-030: panes waiting on the user
  const [hook, setHook] = useState<Record<number, AgentState>>({}); // STAT-001: each pane's last hook-fed state
  // STAT-050: when each pane's state last moved, and whether that turn was interrupted; the Inbox's clock.
  const [stamp, setStamp] = useState<Record<number, { at: number; interrupted: boolean }>>({});
  // VIEW-023: what each pane's last event said it was doing, and the newest file it wrote this session.
  // TERM-036: the agent's own session id per pane, from its hooks.
  const [turn, setTurn] = useState<Record<number, TurnInfo>>({});
  // STAT-045: the terminal has printed nothing for the quiet window; cleared by the next event.
  const [stale, setStale] = useState<Record<number, boolean>>({});
  const [context, setContext] = useState<Record<number, ContextReading>>({}); // STAT-040: each Claude pane's last context reading
  const [crew, setCrew] = useState<Record<number, Crew>>({}); // STAT-026: each pane's sub-agents and teammates
  const hookRef = useRef(hook);
  hookRef.current = hook;
  const runRef = useRef(running); // TERM-118: the last reported running flags, to see a finish
  runRef.current = running;
  const [unreadPanes, setUnreadPanes] = useState<Set<number>>(new Set()); // TERM-118: finished or rang out of view
  const [unreadDirs, setUnreadDirs] = useState<Set<string>>(new Set()); // PROJ-063 / TERM-118: workspace rows marked unread
  const [winFocused, setWinFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setWinFocused(true);
    const off = () => setWinFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  const markDir = (dir: string, un: boolean) => setUnreadDirs((u) => new Set(un ? [...u, dir] : [...u].filter((d) => !sameDir(d, dir))));
  return { needs, setNeeds, hook, setHook, stamp, setStamp, turn, setTurn, stale, setStale, context, setContext, crew, setCrew, hookRef, runRef, unreadPanes, setUnreadPanes, unreadDirs, setUnreadDirs, winFocused, markDir };
}

type Status = ReturnType<typeof useAgentStatusState>;

type EventsDeps = Pick<Status, "setCrew" | "setTurn" | "setStale" | "hookRef" | "setHook" | "setStamp" | "setContext" | "unreadPanes" | "setUnreadPanes" | "winFocused" | "markDir"> & {
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  titles: Record<number, string>;
  settings: Record<string, unknown>;
  inView: (key: number) => boolean;
  setToast: (text: string) => void;
  tabName: (p: Pane, titles: Record<number, string>) => string;
};

export function useAgentEvents({ panes, setPanes, titles, settings, inView, setToast, tabName, setCrew, setTurn, setStale, hookRef, setHook, setStamp, setContext, unreadPanes, setUnreadPanes, winFocused, markDir }: EventsDeps) {
  // STAT-041: the note names the repository when more than one has agents running.
  const repoOf = (p: Pane): string | null => {
    const repos = new Set(panes.filter((x) => x.agent !== "shell" && x.cwd !== null).map((x) => folderName(x.cwd as string)));
    return repos.size > 1 && p.cwd !== null ? folderName(p.cwd) : null;
  };
  const noticed = (p: Pane, what: string, body = "", gate: KindKey = "notifyOnFinish") => {
    const known = new Set(panes.map((x) => x.key));
    if (!known.has(p.key)) return;
    const title = noteTitle(tabName(p, titles), repoOf(p), what);
    // STAT-041: every note on a pane out of view (or in an unfocused window) is a desktop
    // notification unless 'Agent Task Complete' is off (a stop goes by 'Agent Stopped', STAT-023);
    // the unread mark and the toast keep T-024's one-mark-until-viewed rule.
    if (!(inView(p.key) && winFocused) && settings[gate] !== false) invoke("notify", { title, body }).catch(() => {});
    if (!marksUnread(p.key, known, unreadPanes, inView(p.key), winFocused)) return;
    setUnreadPanes((u) => new Set([...u, p.key]));
    if (p.cwd !== null) markDir(p.cwd, true);
    setToast(title);
  };
  const noticedRef = useRef(noticed);
  noticedRef.current = noticed;
  // STAT-045: the quiet alert has its own switch (the minutes), so neither the view nor the finish
  // switch gates it: a toast and a desktop notification, once per silent spell.
  const quiet = (p: Pane, minutes: number) => {
    const title = noteTitle(tabName(p, titles), repoOf(p), `has gone quiet for ${minutes} min`);
    setToast(title);
    invoke("notify", { title, body: "No terminal output since then. It may be stuck." }).catch(() => {});
  };
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  const panesRef = useRef(panes);
  panesRef.current = panes;
  useEffect(() => {
    // STAT-001: the hooks report each pane's state; a turn ending out of view is noticed like an exit.
    const off = listen<{ paneKey: number; children: Crew; tool?: string; detail?: string; wrote?: string; plan?: string; planCut?: boolean; session?: string } & Turn>("agent-status", (e) => {
      const { paneKey, state, children, tool, detail, reply, wrote, boundary, stop, plan, planCut, session } = e.payload;
      // SESS-030: the newest session id is what a restart resumes (a /clear or a resume brings a new one).
      if (session) setPanes((ps) => (ps.some((p) => p.key === paneKey && p.session !== session) ? ps.map((p) => (p.key === paneKey ? { ...p, session } : p)) : ps));
      setCrew((c) => (children.length === 0 && !(paneKey in c) ? c : { ...c, [paneKey]: children }));
      setTurn((t) => ({ ...t, [paneKey]: { tool, detail, reply, stop, plan, planCut, wrote: boundary ? undefined : (wrote ?? t[paneKey]?.wrote) } }));
      setStale((m) => (m[paneKey] ? { ...m, [paneKey]: false } : m));
      const prev = hookRef.current[paneKey];
      // STAT-041: a finish, a permission request, a block, an interrupt or a sub-agent's turn is a note.
      const note = turnNote(prev, e.payload);
      if (note) {
        const p = panesRef.current.find((x) => x.key === paneKey);
        if (p) noticedRef.current(p, note.what, note.body, note.stopped ? "notifyOnStopped" : "notifyOnFinish");
      }
      // STAT-046: a stop on a sign-in failure has the account checked, so the main-window notice
      // (SignInNotice) names the lapsed account without waiting for the next start.
      if (stop?.cause === "signin" && prev !== "blocked") invoke("claude_account_check").catch(() => {});
      if (prev !== state) {
        setHook((h) => ({ ...h, [paneKey]: state }));
        setStamp((m) => ({ ...m, [paneKey]: { at: Date.now(), interrupted: e.payload.interrupted } }));
      }
    });
    // STAT-045: the quiet alert comes from the terminal's own silence, judged in Rust.
    const offUsage = listen<{ paneKey: number; contextTokens: number | null; contextWindow: number | null }>("claude-usage", (e) => {
      const { paneKey, contextTokens, contextWindow } = e.payload;
      if (contextTokens !== null && contextWindow !== null) setContext((c) => ({ ...c, [paneKey]: { tokens: contextTokens, window: contextWindow } }));
    });
    const offQuiet = listen<{ paneKey: number; minutes: number }>("agent-quiet", (e) => {
      const p = panesRef.current.find((x) => x.key === e.payload.paneKey);
      if (p) quietRef.current(p, e.payload.minutes);
      setStale((m) => ({ ...m, [e.payload.paneKey]: true }));
    });
    return () => {
      off.then((f) => f());
      offQuiet.then((f) => f());
      offUsage.then((f) => f());
    };
  }, []);
  useEffect(() => {
    // Viewing a marked pane in a focused window clears its mark.
    if (!winFocused || unreadPanes.size === 0) return;
    const seen = [...unreadPanes].filter(inView);
    if (seen.length === 0) return;
    setUnreadPanes((u) => new Set([...u].filter((k) => !seen.includes(k))));
    for (const p of panes) if (seen.includes(p.key) && p.cwd !== null) markDir(p.cwd, false);
  });
  return { noticed, panesRef };
}
