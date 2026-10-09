// The plus menu (SESS-001, SESS-004): which agent to start in a new pane. The list comes from the
// Rust side, which looks each agent's program up on the PATH and in the usual install folders;
// only agents that were found are offered, the rest stay out of sight (SESS-001). The default
// agent is listed first with its shortcut beside it, when one is bound; every other row has a
// "default" button that makes that agent the default. Drawn as a fixed popover with a click-away
// backdrop, so it is never clipped by the pane or sidebar card it opens from.
import type { CSSProperties } from "react";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import { Kbd, useLabel } from "../keys/KeymapContext";
import { menuAgents } from "./agents";

export type AgentInfo = { id: string; name: string; program: string; args: string[]; installed: boolean; path: string | null };

/** Which vendor mark an agent id draws; anything unknown gets the plain-shell glyph. */
export function markFor(id: string): Agent {
  return id === "claude" || id === "codex" ? id : "shell";
}

/** The pane-header word for what runs in a pane. */
export function programWord(agent: Agent): string {
  return agent === "claude" ? "Claude" : agent === "codex" ? "Codex" : "PowerShell";
}

type Props = {
  agents: AgentInfo[];
  /** The default agent's id: listed first, with the "new agent tab" shortcut beside it. */
  defaultId?: string;
  onPick: (agent: AgentInfo) => void;
  onSetDefault?: (id: string) => void;
  /** Opens a chooser pane instead (SESS-007). */
  onChoose?: () => void;
  onClose: () => void;
  busy?: boolean;
  style?: CSSProperties;
};

export default function PlusMenu({ agents, defaultId = "claude", onPick, onSetDefault, onChoose, onClose, busy = false, style }: Props) {
  const shown = menuAgents(agents, defaultId);
  const bound = useLabel("tab.newAgent").length > 0;
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="menu" role="menu" aria-label="New session" style={style}>
        <div className="menu-title">New session</div>
        {agents.length === 0 && <div className="menu-hint">Looking for agents…</div>}
        {agents.length > 0 && shown.length === 0 && (
          <div className="menu-hint">No agent found. Kolux looked for {agents.map((a) => a.program).join(", ")} on the PATH and in the usual install folders.</div>
        )}
        {shown.map((a) => (
          <div className="menu-row" key={a.id}>
            <button role="menuitem" className="menu-item" disabled={busy} onClick={() => onPick(a)} title={`Start ${a.name} (${a.path}) in a new pane inside a fresh workspace`}>
              <span className="agent-mark">
                <VendorMark agent={markFor(a.id)} size={13} />
              </span>
              <span className="name">{a.name}</span>
              {a.id === defaultId && bound && <Kbd id="tab.newAgent" />}
            </button>
            {a.id !== defaultId && onSetDefault && (
              <button className="menu-default" title={`Make ${a.name} the default agent`} onClick={() => onSetDefault(a.id)}>
                default
              </button>
            )}
          </div>
        ))}
        {onChoose && (
          <button role="menuitem" className="menu-item" onClick={onChoose} title="Open a pane that asks which AI, model or terminal to run, and how many">
            <span className="agent-mark" aria-hidden="true">
              ?
            </span>
            <span className="name">Choose what to run…</span>
          </button>
        )}
        <button role="menuitem" className="menu-item muted" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
