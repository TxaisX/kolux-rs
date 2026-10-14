// VIEW-114: the sidebar's onboarding slot, mounted once in the sidebar above its footer
// (ProjectsPanel, coordinator hunk T-295-sidebar.diff). It shows the newcomer checklist while that is
// up, else the Setup Guide entry while a core step remains; it renders nothing until its reads have
// answered, so it never flashes. The project count it is given re-reads the steps when a project is
// added, so the step that project completes ticks in place.
import Checklist, { useChecklistRecord } from "./Checklist";
import { Ring, useGuideState } from "./Guides";
import { openGuide } from "./guide";
import { checklistOf } from "./newcomer";
import { entryLine, guideWanted, sidebarSlot } from "./sidebar";
import "./onboarding.css";

export default function SidebarStart({ projects }: { projects: number }) {
  const rec = useChecklistRecord();
  const first = rec === undefined ? undefined : (rec?.firstRun ?? null);
  const c = checklistOf(first, rec?.tried ?? []);
  const g = useGuideState(guideWanted(c, first), projects);
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
