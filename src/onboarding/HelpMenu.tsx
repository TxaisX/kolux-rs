// ONB-014: the help menu in the sidebar footer. Getting Started opens the Setup Guide, Explore Kolux
// the tour, and Milestones (with its mini ring) stays only while a core step is unfinished.
// The menu itself is a sheet of its own (HelpSheet) that loads the first time it is opened: its ring
// reads the guide's live steps and it lists every tour by name, and none of that is needed to draw
// the first frame. This module is the button only.
import { useState } from "react";
import { Help } from "../chrome/icons";
import { HelpSheet } from "../lazy/pages";

export default function HelpMenu() {
  const [at, setAt] = useState<{ bottom: number; left: number } | null>(null);
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
      {at && <HelpSheet at={at} onClose={() => setAt(null)} />}
    </>
  );
}
