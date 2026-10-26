// SKILL-024 (after-list row 62): the notice that Kolux skills installed outside Kolux are out of date.
// The window mounts it, so it shows wherever the user is, once per session, after settings have loaded;
// Review opens the Skills page and its update dialog, Dismiss remembers the exact copies and revisions.
import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close } from "../chrome/icons";
import { skillBar } from "./skillBarStore";
import { claimNotice, freshKeys, noticeText, type Checked } from "./updateNotice";
import "./skillNotice.css";

type Props = { settingsLoaded: boolean };

export default function SkillUpdateNotice({ settingsLoaded }: Props) {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [shown, setShown] = useState(false);
  const runDone = useSyncExternalStore(skillBar.subscribe, skillBar.get).status?.state === "done";
  // Looked at again when settings arrive and when an update run ends, so a fixed skill withdraws the notice.
  useEffect(() => {
    if (!settingsLoaded) return;
    let live = true;
    invoke<Checked>("skills_update_check", { workspace: null }).then(
      (c) => live && setChecked(c),
      () => live && setChecked(null),
    );
    return () => void (live = false);
  }, [settingsLoaded, runDone]);
  useEffect(() => {
    if (claimNotice(checked, settingsLoaded)) setShown(true);
  }, [checked, settingsLoaded]);

  const left = checked ? freshKeys(checked) : [];
  if (!shown || !checked || checked.report.available === 0 || left.length === 0) return null;
  return (
    <div className="skill-notice" role="status">
      <span>{noticeText(checked.report.available)}</span>
      <button className="btn" onClick={() => (setShown(false), skillBar.click())}>
        Review
      </button>
      <button className="ib" aria-label="Dismiss" title="Dismiss" onClick={() => (setShown(false), invoke("skills_update_dismiss", { keys: left }).catch(() => undefined))}>
        <Close />
      </button>
    </div>
  );
}
