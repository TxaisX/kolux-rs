// SKILL-027 / VIEW-100: the status bar item for a running skill update. It reads the store in
// skillBarStore.ts; the status bar only has to place <SkillBarItem /> (and the App listens for the
// show event, see BringSkillsUp below, to bring the Skills page up when it is not showing).
import { useEffect, useSyncExternalStore } from "react";
import { skillBar, SKILLS_SHOW_EVENT } from "./skillBarStore";

export default function SkillBarItem() {
  const { item } = useSyncExternalStore(skillBar.subscribe, skillBar.get, skillBar.get);
  if (!item) return null;
  return (
    <button className={`item skill-item ${item.tone}`} title={item.title} onClick={() => skillBar.click()}>
      {item.tone === "info" ? <span className="spin" aria-hidden="true" /> : <span className="dot" aria-hidden="true" />}
      {item.tone === "ok" && <span aria-hidden="true">{"✓"} </span>}
      {item.text}
    </button>
  );
}

/** The App mounts this once: a click on the item (or a pill) while another screen is up opens the Skills page,
 * whose dialog then shows itself (it asks the store whether a click is waiting). */
export function BringSkillsUp({ onShow }: { onShow: () => void }) {
  useEffect(() => {
    window.addEventListener(SKILLS_SHOW_EVENT, onShow);
    return () => window.removeEventListener(SKILLS_SHOW_EVENT, onShow);
  }, [onShow]);
  return null;
}
