// The Codex half of the usage pill: real plan figures read in the background (USAGE-022), a
// warn-coloured "sign in again" when the sign-in is no longer accepted.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import VendorMark from "../chrome/VendorMark";
import { pillDetail, pillText, type CodexUsage } from "./codex";
import { publishCodex, usePlan } from "./plan";

const EVERY_MS = 10 * 60 * 1000;

export function CodexPillView({ usage }: { usage: CodexUsage | null }) {
  const warn = usage?.state === "sign-in-again";
  return (
    <span className={warn ? "usage-part warn" : "usage-part"} title={pillDetail(usage)} data-codex-state={usage?.state ?? "reading"}>
      <VendorMark agent="codex" size={13} />
      <span>{pillText(usage)}</span>
    </span>
  );
}

export default function CodexPill() {
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
          else setUsage(u);
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
  return <CodexPillView usage={usage} />;
}
