// ONB-014: the help menu in the sidebar footer. Getting Started opens the Setup Guide, Explore Kolux
// the tour, and Milestones (with its mini ring) stays only while a core step is unfinished.
import { useState } from "react";
import { Help } from "../chrome/icons";
import { milestonesShown, openExplore, openGuide, ring } from "./guide";
import { Ring, useGuideState } from "./Guides";
import { replayTour, TOURS } from "./tour";
import { REOPEN_WIZARD } from "./firstRun";

export default function HelpMenu() {
  const [at, setAt] = useState<{ bottom: number; left: number } | null>(null);
  const g = useGuideState(at !== null);
  const r = ring(g.done);
  const pick = (go: () => void) => {
    setAt(null);
    go();
  };
  return (
    <>
      <button
        className="ib"
        title="Help"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          setAt({ bottom: window.innerHeight - b.top + 4, left: Math.max(8, b.left) });
        }}
      >
        <Help />
      </button>
      {at && (
        <>
          <div className="menu-backdrop" onClick={() => setAt(null)} aria-hidden="true" />
          <div className="menu" role="menu" aria-label="Help" style={at} onKeyDown={(e) => e.key === "Escape" && setAt(null)}>
            <button role="menuitem" className="menu-item" onClick={() => pick(() => openGuide())} autoFocus>
              Getting Started with Kolux
            </button>
            <button role="menuitem" className="menu-item" onClick={() => pick(openExplore)}>
              Explore Kolux
            </button>
            {/* ONB-009: the first-run wizard again. */}
            <button role="menuitem" className="menu-item" onClick={() => pick(() => window.dispatchEvent(new CustomEvent(REOPEN_WIZARD)))}>
              Onboarding
            </button>
            {milestonesShown(g.done) && (
              <button role="menuitem" className="menu-item" onClick={() => pick(() => openGuide())}>
                <Ring done={r.done} total={r.total} size={18} />
                Milestones
                <span className="menu-hint-inline">
                  {r.done}/{r.total}
                </span>
              </button>
            )}
            {/* ONB-032: replay any tour, seen or not, whatever this launch already showed. */}
            <div className="menu-title">Tours</div>
            {TOURS.map((t) => (
              <button key={t.id} role="menuitem" className="menu-item" title="Runs once its screen is showing" onClick={() => pick(() => replayTour(t.id))}>
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
