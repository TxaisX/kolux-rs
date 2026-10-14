// VIEW-114: the sidebar's onboarding slot, mounted once in the sidebar above its footer
// (ProjectsPanel, coordinator patch evidence/accounts-FIX-3-sidebar.patch, held until T-333-b and
// reliability R2 land). It shows the newcomer checklist while that is up, else the Setup Guide entry while a core step remains; it renders nothing until its reads have
// answered, so it never flashes. It reads the steps again on every Setup Guide close, every added
// project and window focus once 30 s have passed since its last read, so a step done elsewhere ticks
// in place (FIX-2, FIX-3).
import { useEffect, useState } from "react";
import Checklist, { useChecklistRecord } from "./Checklist";
import { Ring, useGuideState } from "./Guides";
import { openGuide } from "./guide";
import { checklistOf } from "./newcomer";
import { entryLine, guideWanted, onReread, sidebarSlot } from "./sidebar";
import "./onboarding.css";

export default function SidebarStart() {
  const rec = useChecklistRecord();
  const [again, setAgain] = useState(0);
  useEffect(() => onReread(window, () => setAgain((n) => n + 1)), []);
  const first = rec === undefined ? undefined : (rec?.firstRun ?? null);
  const c = checklistOf(first, rec?.tried ?? []);
  const g = useGuideState(guideWanted(c, first), again);
  const slot = sidebarSlot(c, first, g.settled);
  if (slot === "checklist") return <Checklist compact record={rec} />;
  if (slot !== "guide" || !g.settled) return null;
  const line = entryLine(g.settled);
  return (
    <button className="onb-entry" onClick={() => openGuide(line.nextId ?? undefined)} title="Open Getting Started with Kolux">
      <Ring done={line.done} total={line.total} size={22} />
      <span className="text">
        <span className="name">Getting Started</span>
        <span className="about">
          {line.count} done{line.next ? ` · next: ${line.next}` : ""}
        </span>
      </span>
    </button>
  );
}
