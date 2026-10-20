// T-550: the top bar's usage pill (USAGE-008) is one button: the Claude and Codex parts inside it
// keep their look and hover detail, and a click opens Settings at Accounts & keys, scrolled to AI connections (the record of
// T-043-a: "click the usage pill in the top bar").
import type { ReactNode } from "react";
import { openSettings } from "../settings/pages";
import ClaudePill from "./ClaudePill";
import CodexPill from "./CodexPill";
import "./usage.css";

export const PILL_TITLE = "Usage: open Settings › Accounts & keys";

/** Settings at Accounts & keys, scrolled to the AI connections section, from the pill. */
export const openAccounts = () => openSettings("accounts", "connections");

export function UsagePillView({ hidden, onOpen, children }: { hidden: boolean; onOpen: () => void; children?: ReactNode }) {
  return (
    <button type="button" className="usage" hidden={hidden} title={PILL_TITLE} aria-describedby="usage-pill-hint" onClick={onOpen}>
      {/* FIX-5 (council P2 P12): the title shows on hover only; the same words are the button's description. */}
      <span id="usage-pill-hint" style={{ display: "none" }}>
        {PILL_TITLE}
      </span>
      {children}
    </button>
  );
}

/** The pill with both providers' parts; hidden while neither has a figure to show. */
export default function UsagePill({ hidden, claudeOn, codexOn }: { hidden: boolean; claudeOn: boolean; codexOn: boolean }) {
  return (
    <UsagePillView hidden={hidden} onOpen={openAccounts}>
      <ClaudePill installed={claudeOn} />
      <CodexPill installed={codexOn} />
    </UsagePillView>
  );
}
