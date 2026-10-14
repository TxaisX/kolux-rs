// The Codex half of the usage pill: real plan figures read in the background (USAGE-022), a
// warn-coloured "sign in again" when the sign-in is no longer accepted.
// USAGE-023 (T-070): the read runs on the shared scheduler (five-minute timer, window focus with
// a short debounce and backoff while it keeps failing, manual refresh); a failed read keeps the
// figures already shown and raises a steady error mark instead of blanking the pill.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import VendorMark from "../chrome/VendorMark";
import { TroubleMark } from "./ClaudePill";
import { pillDetail, pillText, type CodexUsage } from "./codex";
import { publishCodex as publishLaunch } from "./launchWarn";
import { tone } from "./meter";
import { publishCodex, readPlan, usePlan, useResetTick } from "./plan";
import { codexFetched, runner, useRefresh } from "./refresh";

/** USAGE-008: drawn only for an installed Codex with a known weekly window (or a refused sign-in). */
export function CodexPillView({ usage, installed = true, trouble = false }: { usage: CodexUsage | null; installed?: boolean; trouble?: boolean }) {
  const warn = usage?.state === "sign-in-again";
  useResetTick([usage?.weekly?.resetsAt && usage.weekly.resetsAt * 1000]); // USAGE-024
  if (!installed || !usage || !(warn || usage.weekly)) return null;
  const cls = warn ? "usage-part warn" : `usage-part ${tone(usage.weekly?.usedPercent ?? 0)}`.trim();
  return (
    <span className={cls} title={pillDetail(usage)} data-codex-state={usage.state} data-usage-trouble={trouble ? "1" : undefined}>
      <VendorMark agent="codex" size={13} />
      <span>{pillText(usage)}</span>
      {trouble && <TroubleMark />}
    </span>
  );
}

export default function CodexPill({ installed }: { installed?: boolean }) {
  const { codex: usage } = usePlan();
  const sched = useRefresh("codex");
  useEffect(() => {
    const r = runner<CodexUsage>({
      name: "codex",
      fetch: () => invoke<CodexUsage>("codex_usage").then(codexFetched),
      onOk: (u) => {
        publishCodex(u);
        publishLaunch(u);
      },
      // The figures already shown stay through a failure; only a pill that never got any says why.
      onFail: (message) => {
        if (!readPlan().codex) publishCodex({ state: "error", fiveHour: null, weekly: null, resetCredits: null, plan: null, message });
      },
    });
    r.start();
    return () => r.stop();
  }, []);
  return <CodexPillView usage={usage} installed={installed} trouble={sched.failures > 0} />;
}
