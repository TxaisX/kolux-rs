// The Claude half of the usage pill (STAT-040): the last status-line report at start, then
// every report as it arrives; a report with no windows (context only) changes nothing here.
// USAGE-023 (T-070): the stored report is read again on the five-minute timer, on a window focus
// and on a manual refresh through the shared scheduler; a report pushed while the start-up read is
// still running is kept, because an empty answer never replaces figures already shown.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { StatusGlyph } from "../chrome/icons";
import { pillDetail, pillText, weeklyOf, type ClaudeLimit } from "./claude";
import { tone } from "./meter";
import { publishClaude as publishLaunch } from "./launchWarn";
import { publishClaude as publishPlan, usePlan, useResetTick } from "./plan";
import { claudeFetched, runner, useRefresh } from "./refresh";
import { lineFor, record } from "./forecast";

/** The top bar's read goes to the plan line and the launch screen's warning alike. */
const publishClaude = (limits: ClaudeLimit[]) => {
  for (const l of limits) record(`claude:${l.kind}`, l.usedPercent, l.resetsAt, Date.now()); // USAGE-031
  publishPlan(limits);
  publishLaunch(limits);
};

/** USAGE-023: the steady mark's words while the last read failed; the figures shown are the last good ones. */
export const TROUBLE = "The last usage read failed; these are the last figures that arrived";

/** USAGE-023: a steady error mark inside the pill; no spinner, no blanked figures. */
export function TroubleMark() {
  return (
    <span className="mark" role="img" aria-label="last read failed" title={TROUBLE}>
      <StatusGlyph glyph="failed" size={10} />
    </span>
  );
}

/** USAGE-008: drawn only for an installed Claude with a known weekly window, tinted by its use. */
export function ClaudePillView({ limits, installed = true, trouble = false }: { limits: ClaudeLimit[]; installed?: boolean; trouble?: boolean }) {
  const w = weeklyOf(limits);
  useResetTick([w?.resetsAt]); // USAGE-024: the hover countdown keeps itself current
  if (!installed || !w) return null;
  return (
    <span className={`usage-part ${tone(w.usedPercent)}`.trim()} title={[pillDetail(limits), lineFor(`claude:${w.kind}`, w.resetsAt)].filter(Boolean).join("\n")} data-claude-state="ok" data-usage-trouble={trouble ? "1" : undefined}>
      <VendorMark agent="claude" size={13} />
      <span>{pillText(limits)}</span>
      {trouble && <TroubleMark />}
    </span>
  );
}

export default function ClaudePill({ installed }: { installed?: boolean }) {
  const { claude: limits } = usePlan();
  const sched = useRefresh("claude");
  useEffect(() => {
    const r = runner<ClaudeLimit[]>({ name: "claude", fetch: () => invoke<ClaudeLimit[]>("claude_usage").then(claudeFetched), onOk: publishClaude });
    r.start();
    const off = listen<{ limits: ClaudeLimit[] }>("claude-usage", (e) => {
      if (e.payload.limits.length) publishClaude(e.payload.limits);
    });
    return () => {
      r.stop();
      void off.then((u) => u()).catch(() => {});
    };
  }, []);
  return <ClaudePillView limits={limits} installed={installed} trouble={sched.failures > 0} />;
}
