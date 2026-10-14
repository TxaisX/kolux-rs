// The Codex half of the usage pill: real plan figures read in the background (USAGE-022), a
// warn-coloured "sign in again" when the sign-in is no longer accepted.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import VendorMark from "../chrome/VendorMark";
import { pillDetail, pillText, type CodexUsage } from "./codex";
import { publishCodex as publishLaunch } from "./launchWarn";
import { tone } from "./meter";
import { publishCodex, usePlan, useResetTick } from "./plan";

const EVERY_MS = 10 * 60 * 1000;

/** USAGE-008: drawn only for an installed Codex with a known weekly window (or a refused sign-in). */
export function CodexPillView({ usage, installed = true }: { usage: CodexUsage | null; installed?: boolean }) {
  const warn = usage?.state === "sign-in-again";
  useResetTick([usage?.weekly?.resetsAt && usage.weekly.resetsAt * 1000]); // USAGE-024
  if (!installed || !usage || !(warn || usage.weekly)) return null;
  const cls = warn ? "usage-part warn" : `usage-part ${tone(usage.weekly?.usedPercent ?? 0)}`.trim();
  return (
    <span className={cls} title={pillDetail(usage)} data-codex-state={usage.state}>
      <VendorMark agent="codex" size={13} />
      <span>{pillText(usage)}</span>
    </span>
  );
}

export default function CodexPill({ installed }: { installed?: boolean }) {
  const { codex: usage } = usePlan();
  const setUsage = publishCodex;
  useEffect(() => {
    let live = true;
    let retry = 0;
    const read = () =>
      invoke<CodexUsage>("codex_usage")
        .then((u) => {
          if (!live) return;
          // Another read of the same Codex home is running (one at a time): ask again shortly.
          if (u.state === "busy") retry = window.setTimeout(read, 3000);
          else {
            setUsage(u);
            publishLaunch(u);
          }
        })
        .catch((e) => live && setUsage({ state: "error", fiveHour: null, weekly: null, resetCredits: null, plan: null, message: String(e) }));
    read();
    const t = window.setInterval(read, EVERY_MS);
    return () => {
      live = false;
      window.clearInterval(t);
      window.clearTimeout(retry);
    };
  }, []);
  return <CodexPillView usage={usage} installed={installed} />;
}
