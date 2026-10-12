// The Claude half of the usage pill (STAT-040): the last status-line report at start, then
// every report as it arrives; a report with no windows (context only) changes nothing here.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { pillDetail, pillText, type ClaudeLimit } from "./claude";
import { publishClaude, usePlan } from "./plan";

export function ClaudePillView({ limits }: { limits: ClaudeLimit[] }) {
  return (
    <span className="usage-part" title={pillDetail(limits)} data-claude-state={limits.length ? "ok" : "unknown"}>
      <VendorMark agent="claude" size={13} />
      <span>{pillText(limits)}</span>
    </span>
  );
}

export default function ClaudePill() {
  const { claude: limits } = usePlan();
  useEffect(() => {
    invoke<ClaudeLimit[]>("claude_usage").then(publishClaude).catch(() => {});
    const off = listen<{ limits: ClaudeLimit[] }>("claude-usage", (e) => {
      if (e.payload.limits.length) publishClaude(e.payload.limits);
    });
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
  return <ClaudePillView limits={limits} />;
}
