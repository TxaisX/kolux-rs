// The Claude half of the usage pill (STAT-040): the last status-line report at start, then
// every report as it arrives; a report with no windows (context only) changes nothing here.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { pillDetail, pillText, weeklyOf, type ClaudeLimit } from "./claude";
import { tone } from "./meter";
import { publishClaude as publishLaunch } from "./launchWarn";
import { publishClaude as publishPlan, usePlan } from "./plan";

/** The top bar's read goes to the plan line and the launch screen's warning alike. */
const publishClaude = (limits: ClaudeLimit[]) => {
  publishPlan(limits);
  publishLaunch(limits);
};

/** USAGE-008: drawn only for an installed Claude with a known weekly window, tinted by its use. */
export function ClaudePillView({ limits, installed = true }: { limits: ClaudeLimit[]; installed?: boolean }) {
  const w = weeklyOf(limits);
  if (!installed || !w) return null;
  return (
    <span className={`usage-part ${tone(w.usedPercent)}`.trim()} title={pillDetail(limits)} data-claude-state="ok">
      <VendorMark agent="claude" size={13} />
      <span>{pillText(limits)}</span>
    </span>
  );
}

export default function ClaudePill({ installed }: { installed?: boolean }) {
  const { claude: limits } = usePlan();
  useEffect(() => {
    invoke<ClaudeLimit[]>("claude_usage").then(publishClaude).catch(() => {});
    const off = listen<{ limits: ClaudeLimit[] }>("claude-usage", (e) => {
      if (e.payload.limits.length) publishClaude(e.payload.limits);
    });
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
  return <ClaudePillView limits={limits} installed={installed} />;
}
