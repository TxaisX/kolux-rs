// The plus menu (SESS-001, SESS-004, SESS-002, SESS-003, SESS-010): which agent to start in a new pane. The list comes from the
// Rust side, which looks each agent's program up on the PATH and in the usual install folders;
// only agents that were found are offered, the rest stay out of sight (SESS-001). The default
// agent is listed first with its shortcut beside it, when one is bound; every other row has a
// "default" button that makes that agent the default. Drawn as a fixed popover with a click-away
// backdrop, so it is never clipped by the pane or sidebar card it opens from. SESS-009: Claude Code,
// Codex and Grok lead and the rest fold behind "Show more agents" (folded again on each open); the
// search box reaches every installed agent; a blank-terminal row and "Manage agents" sit at the foot.
import { useState, type CSSProperties } from "react";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import { Kbd, useLabel } from "../keys/KeymapContext";
import { agentRows, MAX_SEARCH, searchAgents, wantsTerminal, type AgentPass } from "./agents";
import { openSettings } from "../settings/pages";

export type AgentInfo = { id: string; name: string; program: string; args: string[]; installed: boolean; path: string | null; docs?: boolean };

/** Which vendor mark an agent id draws; anything unknown gets the plain-shell glyph. */
export function markFor(id: string): Agent {
  return id === "claude" || id === "codex" ? id : "shell";
}

/** ACCT-046: the pane-header word for the shell an automatic pane actually started. */
export function shellWord(path: string): string {
  const stem = (path.split(/[\\/]/).pop() ?? path).replace(/\.exe$/i, "").toLowerCase();
  return ({ pwsh: "PowerShell 7", powershell: "Windows PowerShell", cmd: "Command Prompt" } as Record<string, string>)[stem] ?? stem;
}

/** The pane-header word for what runs in a pane. */
export function programWord(agent: Agent): string {
  return agent === "claude" ? "Claude" : agent === "codex" ? "Codex" : "PowerShell";
}

type Props = {
  agents: AgentInfo[];
  /** The default agent's id: listed first and marked, with the "new agent tab" shortcut beside it. */
  defaultId?: string;
  onPick: (agent: AgentInfo) => void;
  onSetDefault?: (id: string) => void;
  /** Opens a chooser pane instead (SESS-007). */
  onChoose?: () => void;
  onClose: () => void;
  /** The blank-terminal row: a plain shell instead of an agent. */
  onTerminal?: () => void;
  /** "Manage agents": Settings > Agents. */
  onManage?: () => void;
  busy?: boolean;
  style?: CSSProperties;
  /** SESS-003: agents are installed but every one is switched off. */
  allOff?: boolean;
  /** SESS-002: where the agent search stands, and a way to look again. */
  pass?: AgentPass;
  onRefresh?: () => void;
};

export default function PlusMenu({ agents, defaultId = "", onPick, onSetDefault, onChoose, onClose, onTerminal, onManage, busy = false, style, allOff = false, pass, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [more, setMore] = useState(false);
  const { top, more: folded } = agentRows(agents, defaultId);
  const found = searchAgents(agents, query);
  const shown = found ?? (more ? [...top, ...folded] : top);
  const installed = top.length + folded.length;
  const terminalRow = onTerminal && (found === null ? !query.trim() || query.length > MAX_SEARCH : wantsTerminal(query));
  const bound = useLabel("tab.newAgent").length > 0;
  const first = () => (shown[0] ? !busy && onPick(shown[0]) : terminalRow && onTerminal?.());
  // With no default the new-agent shortcut opens the first agent listed (SET-027).
  const opens = shown.find((a) => a.id === defaultId) ?? (defaultId === "" ? shown[0] : undefined);
  const agentSettings = () => {
    onClose();
    openSettings("agents", "agents");
  };
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="menu" role="menu" aria-label="New session" style={style}>
        <div className="menu-title">New session</div>
        {installed > 3 && (
          <input
            className="field menu-search"
            placeholder="Search agents"
            aria-label="Search agents"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter") first();
            }}
          />
        )}
        {found !== null && found.length === 0 && !terminalRow && <div className="menu-hint">No installed agent matches.</div>}
        {pass?.error ? (
          <div className="menu-hint warn" role="alert">
            Kolux could not look for agents ({pass.error}). Nothing can start until a search succeeds.
          </div>
        ) : (pass ? !pass.done : agents.length === 0) ? (
          <div className="menu-hint">Looking for agents…</div>
        ) : allOff ? (
          <div className="menu-hint">No agent is switched on. Turn one on in agent settings.</div>
        ) : (
          agents.length > 0 &&
          installed === 0 && <div className="menu-hint">No agent found. Kolux looked for {agents.map((a) => a.program).join(", ")} on the PATH and in the usual install folders.</div>
        )}
        {shown.map((a) => (
          <div className="menu-row" key={a.id}>
            <button role="menuitem" className="menu-item" disabled={busy || !!pass?.error} onClick={() => onPick(a)} title={`Start ${a.name} (${a.path}) in a new pane inside a fresh workspace`}>
              <span className="agent-mark">
                <VendorMark agent={markFor(a.id)} size={13} />
              </span>
              <span className="name">{a.name}</span>
              {a.id === defaultId && <span className="menu-chip">Default</span>}
              {a === opens && bound && <Kbd id="tab.newAgent" />}
            </button>
            {a.id !== defaultId && onSetDefault && (
              <button className="menu-default" title={`Make ${a.name} the default agent`} onClick={() => onSetDefault(a.id)}>
                Set as default
              </button>
            )}
          </div>
        ))}
        {found === null && folded.length > 0 && (
          <button className="menu-item muted menu-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            <span className="name">{more ? "Show fewer agents" : `Show more agents (${folded.length})`}</span>
          </button>
        )}
        {terminalRow && (
          <button role="menuitem" className="menu-item" onClick={onTerminal} title="A plain shell with no agent">
            <span className="agent-mark">
              <VendorMark agent="shell" size={13} />
            </span>
            <span className="name">Blank terminal</span>
          </button>
        )}
        {onChoose && (
          <button role="menuitem" className="menu-item" onClick={onChoose} title="Open a pane that asks which AI, model or terminal to run, and how many">
            <span className="agent-mark" aria-hidden="true">
              ?
            </span>
            <span className="name">Choose what to run…</span>
          </button>
        )}
        {onManage && (
          <button role="menuitem" className="menu-item muted" onClick={onManage}>
            <span className="name">Manage agents</span>
          </button>
        )}
        {onRefresh && (
          <button role="menuitem" className="menu-item muted" disabled={pass?.looking} onClick={onRefresh} title="Look for installed agent CLIs again">
            {pass?.looking ? "Looking for agents…" : "Refresh agents"}
          </button>
        )}
        {!onManage && (
          <button role="menuitem" className="menu-item muted" onClick={agentSettings} title="Switch agents on or off, and pick the default, in Settings › Agents">
            {allOff ? "Agent settings…" : "Hide agents…"}
          </button>
        )}
        <button role="menuitem" className="menu-item muted" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
