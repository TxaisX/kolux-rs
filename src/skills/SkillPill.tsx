// SKILL-025: the small freshness pill for a Kolux skill. Clicking it opens the details of the
// update dialog (the Skills page, which owns that dialog, listens for the show event).
import type { Pill } from "./skillBar";
import { SKILLS_SHOW_EVENT } from "./skillBarStore";

export default function SkillPill({ pill, onDetails }: { pill: Pill; onDetails?: () => void }) {
  const open = onDetails ?? (() => window.dispatchEvent(new Event(SKILLS_SHOW_EVENT)));
  const detail = pill.kind === "update" || pill.kind === "review" || pill.kind === "failed";
  return detail ? (
    <button className={`skills-pill ${pill.tone}`} title="Show the update details" onClick={open}>
      {pill.text}
    </button>
  ) : (
    <span className={`skills-pill ${pill.tone}`} role="status">
      {pill.text}
    </span>
  );
}
