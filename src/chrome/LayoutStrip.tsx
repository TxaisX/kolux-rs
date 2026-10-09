// The 40 px layout strip (DESIGN.md section 6): "Layout" and the 1 / 2 / 4 / 6 group. A button
// sets how many cells the workspace in front holds (TERM-001); the pressed one is the current
// count, so none is pressed at 3, 5 or above 6. On the right, "New tab" opens the tab create menu
// (TERM-040 / TERM-041): a shell, or any installed agent, as a tab beside the focused pane.
import { useState } from "react";
import { Plus } from "./icons";
import VendorMark from "./VendorMark";
import { Kbd } from "../keys/KeymapContext";
import { markFor, type AgentInfo } from "../launch/PlusMenu";

const choices = [1, 2, 4, 6];

type Props = { count: number; onLayout: (n: number) => void; agents?: AgentInfo[]; onNewTab?: (agent: AgentInfo | null) => void };

export default function LayoutStrip({ count, onLayout, agents = [], onNewTab }: Props) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const pick = (a: AgentInfo | null) => {
    setAt(null);
    onNewTab?.(a);
  };
  return (
    <div className="strip">
      <span>Layout</span>
      <div className="layouts" role="group" aria-label="Panes per screen">
        {choices.map((n) => (
          <button key={n} aria-pressed={count === n} onClick={() => onLayout(n)} title={n === 1 ? "One pane" : `${n} panes: empty panes are added, unstarted ones removed`}>
            {n}
          </button>
        ))}
      </div>
      {onNewTab && (
        <button
          className="btn newtab"
          aria-haspopup="menu"
          aria-expanded={at !== null}
          title="New tab beside the focused pane (Ctrl+T for a shell)"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
          }}
        >
          <Plus size={12} /> New tab
        </button>
      )}
      {at && (
        <>
          <div className="menu-backdrop" onClick={() => setAt(null)} aria-hidden="true" />
          <div className="menu" role="menu" aria-label="New tab" style={at}>
            <div className="menu-title">New tab</div>
            <button role="menuitem" className="menu-item" onClick={() => pick(null)}>
              <span className="agent-mark">
                <VendorMark agent="shell" size={14} />
              </span>
              <span className="name">Terminal</span>
              <Kbd id="tab.newTerminal" />
            </button>
            {agents.map((a) => (
              <button key={a.id} role="menuitem" className="menu-item" onClick={() => pick(a)}>
                <span className="agent-mark">
                  <VendorMark agent={markFor(a.id)} size={14} />
                </span>
                <span className="name">{a.name}</span>
                <Kbd id={`tab.newAgent.${a.id}`} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
