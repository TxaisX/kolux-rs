// The plus menu (SESS-001, SESS-004): which agent to start in a new pane. The list comes from the
// Rust side, which looks each agent's program up on the PATH; only agents that were found can be
// chosen, the rest stay greyed with "not installed" so the user sees what Kolux looked for. The
// default agent (Claude Code) is listed first. Drawn as a fixed popover with a click-away
// backdrop, so it is never clipped by the pane or sidebar card it opens from.
import type { CSSProperties } from "react";
import VendorMark, { type Agent } from "../chrome/VendorMark";

export type AgentInfo = { id: string; name: string; program: string; args: string[]; installed: boolean; path: string | null };

/** Which vendor mark an agent id draws; anything unknown gets the plain-shell glyph. */
export function markFor(id: string): Agent {
  return id === "claude" || id === "codex" ? id : "shell";
}

/** The pane-header word for what runs in a pane. */
export function programWord(agent: Agent): string {
  return agent === "claude" ? "Claude" : agent === "codex" ? "Codex" : "PowerShell";
}

type Props = { agents: AgentInfo[]; onPick: (agent: AgentInfo) => void; onClose: () => void; busy?: boolean; style?: CSSProperties };

export default function PlusMenu({ agents, onPick, onClose, busy = false, style }: Props) {
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="menu" role="menu" aria-label="New session" style={style}>
        <div className="menu-title">New session</div>
        {agents.length === 0 && <div className="menu-hint">Looking for agents…</div>}
        {agents.map((a) => (
          <button
            key={a.id}
            role="menuitem"
            className="menu-item"
            disabled={!a.installed || busy}
            onClick={() => onPick(a)}
            title={a.installed ? `Start ${a.name} (${a.path}) in a new pane inside a fresh workspace` : `${a.program} was not found on the PATH`}
          >
            <span className="agent-mark">
              <VendorMark agent={markFor(a.id)} size={13} />
            </span>
            <span className="name">{a.name}</span>
            {!a.installed && <span className="muted">not installed</span>}
          </button>
        ))}
        <button role="menuitem" className="menu-item muted" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
